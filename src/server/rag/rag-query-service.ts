import type { Pool } from "pg";

import type { AnswerConversationMessage } from "@/server/agent/answer-generator";
import { OpenAiChatClient } from "@/server/ai/openai-compatible";
import { EmbeddingClient, RerankClient } from "@/server/ai/retrieval-providers";
import type { RuntimeConfig } from "@/server/config";
import type { VisibilityConsumer } from "@/server/privacy/visibility-policy";

import { loadAnchoredProfileEvidence } from "./anchored-profile";
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

function isProfileOwnerQuestion(plan: RagQueryPlan) {
  if (plan.entityMentions.some((mention) => mention.role === "required")) return false;
  return plan.subject === "profile_owner";
}

// Questions that ask about the candidate themselves (自我介绍, 你有哪些技能, 你做过哪些项目,
// 你在哪些公司工作过 — any intent with subject=profile_owner and no required entity) must be
// answered from the candidate's own organized material. The candidate's repository/wiki
// documentation describes the products they built and even the tooling configuration of
// their repositories (READMEs, SPECs, AGENTS.md skill lists), which is semantically close
// ("技能", "候选人" appear throughout) yet says nothing about the candidate's own career;
// it dominates retrieval (observed: SPEC.md reranks 0.45-0.67 above resume material at
// 0.36; AGENTS.md skill lists answer "你有哪些技能" with repository tooling) and fools the
// answerability gate into supporting a product/tooling answer. Narrow the evidence scope
// to material/knowledge BEFORE retrieval so product documentation never enters the
// candidate set; the answerability gate then only judges candidate-owned career evidence.
// Questions with a required entity (「我在富途的经历」「Askme 项目怎么样」) keep the
// full scope because repository documentation is legitimate evidence there. The pinned
// public profile document is anchored separately (see loadAnchoredProfileEvidence), so
// career identity evidence never depends on retrieval alone.
function profileEvidenceScope(plan: RagQueryPlan): RagQueryPlan {
  if (!isProfileOwnerQuestion(plan)) return plan;
  const narrowed = plan.desiredEvidenceTypes.filter((type) => type === "material" || type === "knowledge");
  if (narrowed.length === plan.desiredEvidenceTypes.length) return plan;
  return {
    ...plan,
    desiredEvidenceTypes: narrowed,
    degradations: [...new Set([...plan.degradations, "profile_evidence_scope"])],
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
  const retrievalPlan = profileEvidenceScope(effectivePlan);
  const result = await runBoundedRetrieval({
    initialPlan: retrievalPlan,
    config: input.config,
    retrieve: (roundPlan) => retrieveHybridEvidence(input.pool, input.ownerId, input.consumer, roundPlan, input.config, {
      embeddingClient: dependencies.embeddingClient,
      scope: entityResolution.scope,
    }),
    rerankClient: dependencies.rerankClient ?? new RerankClient(input.config.rerank),
  });
  // The owner-pinned public profile document anchors every answer as the first evidence
  // items. Identity questions (自我介绍 / introduce yourself) rarely share literal terms
  // with it, so retrieval alone can miss the document entirely; deterministic presence
  // removes that whole failure class without waiting for a fallback pass. Duplicate
  // chunks that retrieval did surface are dropped so the profile never pays its
  // allowance twice, and the answerability gate still validates every item.
  const anchoredProfile = await loadAnchoredProfileEvidence(input.pool, input.ownerId, input.consumer, input.config);
  const anchoredIds = new Set(anchoredProfile.map((item) => item.evidenceId));
  const anchoredResult = anchoredProfile.length > 0
    ? {
        ...result,
        candidates: [...anchoredProfile, ...result.candidates.filter((item) => !anchoredIds.has(item.evidenceId))],
        degradations: [...new Set([...result.degradations, "anchored_profile"])],
      }
    : result;
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
    profileOwnerEvidence: isProfileOwnerQuestion(plan),
    client: gateClient,
  });
  const temporalAnnotations = annotateTemporalEvidence(anchoredResult.candidates, anchoredResult.plan.constraints.timeRange, input.currentDate?.slice(0, 7));
  const outsideEvidenceIds = new Set(temporalAnnotations.filter((item) => item.status === "outside").map((item) => item.evidenceId));
  const answerabilityEvidence = anchoredResult.candidates.filter((item) => !outsideEvidenceIds.has(item.evidenceId));
  const answerability = await runGate(anchoredResult.plan, answerabilityEvidence, temporalAnnotations.filter((item) => !outsideEvidenceIds.has(item.evidenceId)));
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
  return finalize(anchoredResult, answerability, temporalAnnotations);
}
