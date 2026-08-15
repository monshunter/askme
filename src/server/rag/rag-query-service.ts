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
import { retrieveHybridEvidence } from "./hybrid-retriever";
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
import { annotateTemporalEvidence } from "./temporal-evidence";

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
  const result = await runBoundedRetrieval({
    initialPlan: effectivePlan,
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
  const answerability = await runAnswerabilityGate({
    question: input.question,
    answerAspects: result.plan.answerAspects,
    entityResolution,
    evidence: answerabilityEvidence,
    temporalAnnotations: temporalAnnotations.filter((item) => !outsideEvidenceIds.has(item.evidenceId)),
    client: dependencies.answerabilityClient ?? new OpenAiChatClient({
      apiKey: input.config.ai.apiKey,
      baseUrl: input.config.ai.baseUrl,
      profile: input.config.ai.profiles.verifier,
    }),
  });
  const finalCandidates = answerability.evidence;
  return {
    ...result,
    provisionalCoverage: result.coverage,
    coverage: answerability.coverage,
    candidates: finalCandidates,
    actualTokens: finalCandidates.reduce((total, item) => total + Math.max(item.tokenCount, deterministicTokenCount(item.parentContent)), 0),
    independentFamilyCount: new Set(finalCandidates.map((item) => item.evidenceFamilyId)).size,
    unsupportedAspects: answerability.unsupportedAspects,
    answerabilityAspects: answerability.aspects,
    answerabilityUsage: answerability.usage,
    temporalAnnotations,
    entityResolution,
  };
}
