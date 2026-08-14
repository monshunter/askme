import type { Pool } from "pg";

import type { AnswerConversationMessage } from "@/server/agent/answer-generator";
import { OpenAiChatClient } from "@/server/ai/openai-compatible";
import { RerankClient } from "@/server/ai/retrieval-providers";
import type { RuntimeConfig } from "@/server/config";
import type { VisibilityConsumer } from "@/server/privacy/visibility-policy";

import { runBoundedRetrieval } from "./evidence-orchestrator";
import { retrieveHybridEvidence } from "./hybrid-retriever";
import { evidenceTypes, planRagQuery } from "./query-planner";

export async function retrieveRagForQuestion(input: {
  pool: Pool;
  config: RuntimeConfig;
  ownerId: string;
  consumer: VisibilityConsumer;
  question: string;
  conversation?: AnswerConversationMessage[];
}) {
  const planner = new OpenAiChatClient({ apiKey: input.config.ai.apiKey, baseUrl: input.config.ai.baseUrl, profile: input.config.ai.profiles.planner });
  const plan = await planRagQuery({ question: input.question, conversation: input.conversation, allowedEvidenceTypes: [...evidenceTypes] }, planner);
  return runBoundedRetrieval({
    initialPlan: plan,
    config: input.config,
    retrieve: (roundPlan) => retrieveHybridEvidence(input.pool, input.ownerId, input.consumer, roundPlan, input.config),
    rerankClient: new RerankClient(input.config.rerank),
  });
}
