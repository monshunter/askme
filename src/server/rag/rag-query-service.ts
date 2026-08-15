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
} from "./entity-catalog";
import { runBoundedRetrieval } from "./evidence-orchestrator";
import { retrieveHybridEvidence } from "./hybrid-retriever";
import { applyHostEntityMentions, conversationalReferenceText, evidenceTypes, planRagQuery, type RagQueryPlan } from "./query-planner";

type RagQueryDependencies = {
  plannerClient?: Pick<OpenAiChatClient, "complete">;
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
      ? [{ text: focus[0]!.canonicalName, type: focus[0]!.type, source: "contextual" as const }]
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
}, dependencies: RagQueryDependencies = {}) {
  const planner = dependencies.plannerClient ?? new OpenAiChatClient({ apiKey: input.config.ai.apiKey, baseUrl: input.config.ai.baseUrl, profile: input.config.ai.profiles.planner });
  const plan = await planRagQuery({ question: input.question, conversation: input.conversation, allowedEvidenceTypes: [...evidenceTypes] }, planner);
  const catalog = await loadAuthorizedEntityCatalog(input.pool, input.ownerId, input.consumer);
  const referenceText = conversationalReferenceText(input.question);
  const focusIsControlled = Boolean(referenceText && (input.contextEntityFocus || input.conversationId));
  const loadedFocus = !input.contextEntityFocus && referenceText && input.conversationId
    ? await loadConversationEntityFocus(input.pool, input.ownerId, input.conversationId)
    : null;
  const focus = input.contextEntityFocus ?? loadedFocus?.entities ?? [];
  const focusStatus = loadedFocus?.status ?? (focus.length === 1 ? "unique" : focus.length === 0 ? "missing" : "ambiguous");
  const resolvedPlan = resolveRagPlanEntities({
    plan, question: input.question, catalog, contextEntityFocus: focus, contextFocusControlled: focusIsControlled, contextFocusStatus: focusStatus,
  });
  const effectivePlan = resolvedPlan.plan;
  const entityResolution = resolvedPlan.entityResolution;
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
      plan: effectivePlan,
      candidates: [],
      roundCount: 0,
      routeCounts: [],
      degradations: plan.degradations,
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
  const answerability = await runAnswerabilityGate({
    question: input.question,
    answerAspects: result.plan.answerAspects,
    entityResolution,
    evidence: result.candidates,
    client: dependencies.answerabilityClient ?? new OpenAiChatClient({
      apiKey: input.config.ai.apiKey,
      baseUrl: input.config.ai.baseUrl,
      profile: input.config.ai.profiles.verifier,
    }),
  });
  return {
    ...result,
    provisionalCoverage: result.coverage,
    coverage: answerability.coverage,
    candidates: answerability.evidence,
    unsupportedAspects: answerability.unsupportedAspects,
    answerabilityAspects: answerability.aspects,
    answerabilityUsage: answerability.usage,
    entityResolution,
  };
}
