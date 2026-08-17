import type { Pool } from "pg";

import type { AnswerConversationMessage } from "@/server/agent/answer-generator";
import { OpenAiChatClient } from "@/server/ai/openai-compatible";
import { EmbeddingClient, RerankClient } from "@/server/ai/retrieval-providers";
import type { RuntimeConfig } from "@/server/config";
import type { VisibilityConsumer } from "@/server/privacy/visibility-policy";

import { runAnswerabilityGate } from "./answerability-gate";
import {
  detectAuthorizedEntityMentions,
  loadAuthorizedEntityCatalog,
  loadConversationEntityFocus,
  normalizeEntityAlias,
  resolveAuthorizedEntities,
  type ConversationEntityFocus,
  type ContextReferenceIssue,
  type EntityMention,
} from "./entity-catalog";
import { runBoundedRetrieval } from "./evidence-orchestrator";
import { retrieveHybridEvidence, type RetrievedRagEvidence } from "./hybrid-retriever";
import {
  adjudicateRagQuery,
  applyHostEntityMentions,
  conversationalReferenceText,
  evidenceTypes,
  planRagQuery,
  ragAdjudicationReason,
  type RagQueryPlan,
} from "./query-planner";
import { deterministicTokenCount } from "./structure-chunker";
import { annotateTemporalEvidence, type TemporalEvidenceAnnotation } from "./temporal-evidence";

type RagQueryDependencies = {
  plannerClient?: Pick<OpenAiChatClient, "complete">;
  adjudicatorClient?: Pick<OpenAiChatClient, "complete">;
  embeddingClient?: Pick<EmbeddingClient, "embed">;
  rerankClient?: Pick<RerankClient, "rerank">;
  answerabilityClient?: Pick<OpenAiChatClient, "complete">;
};

export function resolveRagPlanEntities(input: {
  plan: RagQueryPlan;
  question: string;
  catalog: Awaited<ReturnType<typeof loadAuthorizedEntityCatalog>>;
  contextEntityFocus?: ConversationEntityFocus[];
  contextFocusControlled?: boolean;
  contextFocusStatus?: "unique" | "missing" | "ambiguous";
}) {
  const explicitCatalogMentions = detectAuthorizedEntityMentions(input.question, input.catalog, "explicit");
  const catalogAliases = explicitCatalogMentions.map((mention) => normalizeEntityAlias(mention.text));
  const referenceText = conversationalReferenceText(input.question);
  const focusIsControlled = Boolean(referenceText && input.contextFocusControlled);
  const focus = input.contextEntityFocus ?? [];
  const focusStatus = input.contextFocusStatus ?? (focus.length === 1 ? "unique" : focus.length === 0 ? "missing" : "ambiguous");
  let contextReference: ContextReferenceIssue | null = null;
  const contextualMentions = referenceText && focusIsControlled
    ? focusStatus === "unique" && focus.length === 1
      ? [{ text: focus[0]!.canonicalName, type: focus[0]!.type, source: "contextual" as const, role: "required" as const }]
      : []
    : input.plan.entityMentions.filter((mention) => mention.source === "contextual");
  if (referenceText && focusIsControlled && focusStatus !== "unique") {
    contextReference = { status: focusStatus, referenceText };
  }
  const plan = applyHostEntityMentions(input.plan, [
    ...explicitCatalogMentions,
    ...input.plan.entityMentions.filter((mention) => mention.source === "explicit" && !catalogAliases.some((alias) => {
      const normalized = normalizeEntityAlias(mention.text);
      return alias !== normalized && alias.includes(normalized);
    })),
    ...contextualMentions,
  ]);
  return { plan, entityResolution: resolveAuthorizedEntities(plan.entityMentions, input.catalog, contextReference) };
}

function isProfileOverviewPlan(plan: RagQueryPlan) {
  if (plan.entityMentions.some((mention) => mention.role === "required")) return false;
  return plan.intent === "career_summary" || (plan.intent === "general_career" && plan.subject === "profile_owner");
}

// Profile-overview questions (自我介绍 / introduce yourself) ask about the candidate
// themselves, but the candidate's own repository/wiki documentation describes the products
// they built — semantically close ("职业知识库", "候选人" appear throughout) yet it says
// nothing about the candidate's career, and it dominates retrieval (observed: SPEC.md
// reranks 0.45-0.67 above resume material at 0.36). Narrow the evidence scope to
// material/knowledge BEFORE retrieval so product documentation never enters the candidate
// set; the answerability gate then only judges candidate-owned career evidence. The
// overview fallback stays as a second chance when even that yields no supported evidence.
function profileOverviewEvidenceScope(plan: RagQueryPlan): RagQueryPlan {
  if (!isProfileOverviewPlan(plan)) return plan;
  const narrowed = plan.desiredEvidenceTypes.filter((type) => type === "material" || type === "knowledge");
  if (narrowed.length === plan.desiredEvidenceTypes.length) return plan;
  return {
    ...plan,
    desiredEvidenceTypes: narrowed,
    degradations: [...new Set([...plan.degradations, "profile_evidence_scope"])],
  };
}

// Overview questions (自我介绍 / introduce yourself) rarely share literal terms with
// evidence, and the vector route's top-N can be drowned by large repositories, so a
// candidate's own profile/resume material never surfaces. When the normal pipeline
// yields no supported evidence, re-query against the material corpus with an
// overview-flavored query and drop the literal-term signals; the answerability gate
// still validates the evidence before any answer is produced.
function overviewFallbackPlan(plan: RagQueryPlan): RagQueryPlan {
  const zh = /[\u3400-\u9fff]/u.test(plan.normalizedQuestion);
  const overviewQuery = zh
    ? "候选人的职业概述、主要工作经历、核心技能与项目总结"
    : "the candidate's career overview, key work experience, core skills, and project summary";
  const overviewTerms = zh
    ? ["职业概述", "工作经历", "核心技能", "项目"]
    : ["career overview", "work experience", "core skills", "projects"];
  return {
    ...plan,
    entityMentions: [],
    entities: [],
    mustTerms: [],
    exactPhrases: [],
    shouldTerms: overviewTerms,
    lexicalTerms: overviewTerms,
    trigramProbes: [...plan.trigramProbes.slice(0, 8), ...overviewTerms].slice(0, 24),
    semanticQueries: [overviewQuery],
    desiredEvidenceTypes: ["material", "knowledge"],
    degradations: [...new Set([...plan.degradations, "overview_fallback"])],
  };
}

export async function retrieveRagForQuestion(input: {
  pool: Pool;
  config: RuntimeConfig;
  ownerId: string;
  consumer: VisibilityConsumer;
  question: string;
  conversation?: AnswerConversationMessage[];
  conversationId?: string;
  contextEntityFocus?: ConversationEntityFocus[];
  currentDate?: string;
}, dependencies: RagQueryDependencies = {}) {
  const planner = dependencies.plannerClient ?? new OpenAiChatClient({ apiKey: input.config.ai.apiKey, baseUrl: input.config.ai.baseUrl, profile: input.config.ai.profiles.planner });
  const catalog = await loadAuthorizedEntityCatalog(input.pool, input.ownerId, input.consumer);
  const referenceText = conversationalReferenceText(input.question);
  const focusIsControlled = Boolean(referenceText && (input.contextEntityFocus || input.conversationId));
  const loadedFocus = !input.contextEntityFocus && referenceText && input.conversationId
    ? await loadConversationEntityFocus(input.pool, input.ownerId, input.conversationId)
    : null;
  const focus = input.contextEntityFocus ?? loadedFocus?.entities ?? [];
  const focusStatus = loadedFocus?.status ?? (focus.length === 1 ? "unique" : focus.length === 0 ? "missing" : "ambiguous");
  const catalogCandidates = detectAuthorizedEntityMentions(input.question, catalog, "explicit", "context");
  const trustedContextMentions: EntityMention[] = referenceText && focusIsControlled && focusStatus === "unique" && focus.length === 1
    ? [{ text: focus[0]!.canonicalName, type: focus[0]!.type, source: "contextual", role: "required" }]
    : [];
  let plan = await planRagQuery({
    question: input.question,
    conversation: input.conversation,
    allowedEvidenceTypes: [...evidenceTypes],
    catalogCandidates,
    trustedContextMentions,
  }, planner);
  let resolvedPlan = resolveRagPlanEntities({
    plan, question: input.question, catalog, contextEntityFocus: focus, contextFocusControlled: focusIsControlled, contextFocusStatus: focusStatus,
  });
  const adjudicationReason = ragAdjudicationReason({
    plan: resolvedPlan.plan,
    stopBeforeRetrieval: resolvedPlan.entityResolution.stopBeforeRetrieval,
  });
  if (adjudicationReason) {
    plan = await adjudicateRagQuery({
      question: input.question,
      conversation: input.conversation,
      initialPlan: resolvedPlan.plan,
      reason: adjudicationReason,
      allowedEvidenceTypes: [...evidenceTypes],
      catalogCandidates,
      trustedContextMentions,
    }, dependencies.adjudicatorClient ?? planner);
    resolvedPlan = resolveRagPlanEntities({
      plan, question: input.question, catalog, contextEntityFocus: focus, contextFocusControlled: focusIsControlled, contextFocusStatus: focusStatus,
    });
  }
  const effectivePlan = resolvedPlan.plan;
  const entityResolution = effectivePlan.queryMode === "clarify" && !resolvedPlan.entityResolution.contextReference
    ? { ...resolvedPlan.entityResolution, stopBeforeRetrieval: true, gateReason: "query_clarification_required" as const }
    : resolvedPlan.entityResolution;
  if (entityResolution.stopBeforeRetrieval) {
    const effectiveTokens = Math.max(0, Math.min(
      input.config.rag.evidence.maxTokens,
      input.config.ai.profiles.rag.contextWindow - input.config.rag.evidence.outputReserveTokens - input.config.rag.evidence.safetyMarginTokens,
    ));
    return {
      evidence: [],
      configuredTokens: input.config.rag.evidence.maxTokens,
      effectiveTokens,
      actualTokens: 0,
      independentFamilyCount: 0,
      coverage: "none" as const,
      provisionalCoverage: "none" as const,
      unsupportedAspects: effectivePlan.answerAspects.map((aspect) => aspect.label),
      answerabilityAspects: effectivePlan.answerAspects.map((aspect) => ({ aspectId: aspect.aspectId, status: "unsupported" as const, evidenceIds: [] as string[] })),
      answerabilityUsage: { inputTokens: null, outputTokens: null },
      temporalAnnotations: [],
      plan: effectivePlan,
      candidates: [],
      roundCount: 0,
      routeCounts: [],
      degradations: effectivePlan.degradations,
      rerankInputTokens: null,
      entityResolution,
    };
  }
  const retrievalPlan = profileOverviewEvidenceScope(effectivePlan);
  const result = await runBoundedRetrieval({
    initialPlan: retrievalPlan,
    config: input.config,
    retrieve: (roundPlan) => retrieveHybridEvidence(input.pool, input.ownerId, input.consumer, roundPlan, input.config, {
      embeddingClient: dependencies.embeddingClient,
      scope: entityResolution.scope,
    }),
    rerankClient: dependencies.rerankClient ?? new RerankClient(input.config.rerank),
  });
  const gateClient = dependencies.answerabilityClient ?? new OpenAiChatClient({
    apiKey: input.config.ai.apiKey,
    baseUrl: input.config.ai.baseUrl,
    profile: input.config.ai.profiles.verifier,
  });
  const runGate = (plan: RagQueryPlan, evidence: RetrievedRagEvidence[], annotations: TemporalEvidenceAnnotation[]) => runAnswerabilityGate({
    question: input.question,
    answerAspects: plan.answerAspects,
    entityResolution,
    evidence,
    temporalAnnotations: annotations,
    profileOwnerEvidence: isProfileOverviewPlan(plan),
    client: gateClient,
  });
  const runRetrieval = (retrievalPlan: RagQueryPlan) => runBoundedRetrieval({
    initialPlan: retrievalPlan,
    config: input.config,
    retrieve: (roundPlan) => retrieveHybridEvidence(input.pool, input.ownerId, input.consumer, roundPlan, input.config, {
      embeddingClient: dependencies.embeddingClient,
      scope: entityResolution.scope,
    }),
    rerankClient: dependencies.rerankClient ?? new RerankClient(input.config.rerank),
  });
  const temporalAnnotations = annotateTemporalEvidence(result.candidates, result.plan.constraints.timeRange, input.currentDate?.slice(0, 7));
  const outsideEvidenceIds = new Set(temporalAnnotations.filter((item) => item.status === "outside").map((item) => item.evidenceId));
  const answerabilityEvidence = result.candidates.filter((item) => !outsideEvidenceIds.has(item.evidenceId));
  const answerability = await runGate(result.plan, answerabilityEvidence, temporalAnnotations.filter((item) => !outsideEvidenceIds.has(item.evidenceId)));
  const finalize = (retrieval: Awaited<ReturnType<typeof runBoundedRetrieval>>, gateResult: Awaited<ReturnType<typeof runAnswerabilityGate>>, annotations: TemporalEvidenceAnnotation[]) => {
    const candidates = gateResult.evidence;
    return {
      ...retrieval,
      provisionalCoverage: retrieval.coverage,
      coverage: gateResult.coverage,
      candidates,
      actualTokens: candidates.reduce((total, item) => total + Math.max(item.tokenCount, deterministicTokenCount(item.parentContent)), 0),
      independentFamilyCount: new Set(candidates.map((item) => item.evidenceFamilyId)).size,
      unsupportedAspects: gateResult.unsupportedAspects,
      answerabilityAspects: gateResult.aspects,
      answerabilityUsage: gateResult.usage,
      temporalAnnotations: annotations,
      entityResolution,
    };
  };
  let finalResult = result;
  if (answerability.coverage === "none" && isProfileOverviewPlan(result.plan)) {
    const fallbackPlan = overviewFallbackPlan(result.plan);
    const fallbackResult = await runRetrieval(fallbackPlan);
    const fallbackAnnotations = annotateTemporalEvidence(fallbackResult.candidates, fallbackResult.plan.constraints.timeRange, input.currentDate?.slice(0, 7));
    const fallbackOutsideIds = new Set(fallbackAnnotations.filter((item) => item.status === "outside").map((item) => item.evidenceId));
    const fallbackAnswerability = await runGate(
      fallbackResult.plan,
      fallbackResult.candidates.filter((item) => !fallbackOutsideIds.has(item.evidenceId)),
      fallbackAnnotations.filter((item) => !fallbackOutsideIds.has(item.evidenceId)),
    );
    if (fallbackAnswerability.coverage !== "none") {
      return finalize(fallbackResult, fallbackAnswerability, fallbackAnnotations);
    }
    finalResult = { ...result, degradations: [...new Set([...result.degradations, "overview_fallback"])] };
  }
  return finalize(finalResult, answerability, temporalAnnotations);
}
