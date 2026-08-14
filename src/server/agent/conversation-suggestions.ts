import "server-only";

import type { VisibilityConsumer } from "@/server/privacy/visibility-policy";
import { allowedVisibilities } from "@/server/privacy/visibility-policy";
import { OpenAiChatClient } from "@/server/ai/openai-compatible";
import { getRuntimeConfig } from "@/server/config";
import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";

import { recordSuccessfulAiUsage } from "./ai-usage";
import {
  buildContextualSuggestionFallback,
  buildInitialSuggestedQuestions,
  generateConversationSuggestedQuestions,
  inferSuggestionLocale,
  suggestionContextHash,
  type SuggestionConversationMessage,
  type SuggestionKnowledgeItem,
  type SuggestionLocale,
} from "./suggested-questions";

type ConversationSuggestionRow = {
  id: string;
  suggestionCursor: number;
  suggestedQuestions: string[];
  suggestionsContextHash: string | null;
  rowVersion: string;
};

export async function loadSuggestionTopics(ownerId: string, consumer: VisibilityConsumer) {
  const result = await getPool().query<SuggestionKnowledgeItem>(
    `SELECT topic.type,topic.title FROM (
       SELECT knowledge.type::text AS type,knowledge.title,knowledge.updated_at AS "sortAt",knowledge.id::text AS "stableId"
       FROM knowledge_items knowledge
       WHERE knowledge.owner_id=$1 AND knowledge.status='active' AND EXISTS (
         SELECT 1 FROM knowledge_evidence evidence
         JOIN chunks chunk ON chunk.id=evidence.chunk_id AND chunk.owner_id=evidence.owner_id
         JOIN materials material ON material.id=chunk.material_id AND material.owner_id=chunk.owner_id
         WHERE evidence.knowledge_item_id=knowledge.id AND evidence.owner_id=knowledge.owner_id
           AND material.status='indexed' AND material.visibility=ANY($2::visibility[])
       )
       UNION ALL
       SELECT 'repository' AS type,repository.display_name AS title,repository.updated_at AS "sortAt",repository.id::text AS "stableId"
       FROM repositories repository
       JOIN repository_revisions revision ON revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id AND revision.state='stored'
       JOIN repository_dossier_projections projection ON projection.id=repository.active_projection_id AND projection.state='approved'
       WHERE repository.owner_id=$1 AND repository.disabled_at IS NULL AND repository.visibility=ANY($2::visibility[])
     ) topic
     ORDER BY topic."sortAt" DESC,topic."stableId" DESC LIMIT 24`,
    [ownerId, allowedVisibilities(consumer)],
  );
  return result.rows;
}

async function suggestionConversation(input: { conversationId: string; ownerId: string; mode: "preview" | "public" }) {
  const result = await getPool().query<ConversationSuggestionRow>(
    `SELECT id,suggestion_cursor AS "suggestionCursor",suggested_questions AS "suggestedQuestions",
            suggestions_context_hash AS "suggestionsContextHash",xmin::text AS "rowVersion"
     FROM conversations WHERE id=$1 AND owner_id=$2 AND mode=$3 LIMIT 1`,
    [input.conversationId, input.ownerId, input.mode],
  );
  const conversation = result.rows[0];
  if (!conversation) throw new AppError("CONVERSATION_NOT_FOUND", "The conversation was not found.", 404);
  return conversation;
}

async function settledConversationMessages(conversationId: string, ownerId: string) {
  const result = await getPool().query<SuggestionConversationMessage>(
    `SELECT id,role,status,content FROM messages
     WHERE conversation_id=$1 AND owner_id=$2 AND status='completed' AND source_invalidated_at IS NULL
     ORDER BY created_at,id`,
    [conversationId, ownerId],
  );
  return result.rows;
}

async function hasPendingAnswer(conversationId: string, ownerId: string) {
  const result = await getPool().query<{ pending: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM messages WHERE conversation_id=$1 AND owner_id=$2 AND role='assistant' AND status='pending') AS pending",
    [conversationId, ownerId],
  );
  return result.rows[0]?.pending ?? false;
}

export async function ensureConversationSuggestions(input: {
  conversationId: string;
  ownerId: string;
  mode: "preview" | "public";
  locale: SuggestionLocale;
}) {
  const consumer: VisibilityConsumer = input.mode === "preview" ? "candidate_preview" : "public_answer";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const conversation = await suggestionConversation(input);
    const [messages, topics, pendingAnswer] = await Promise.all([
      settledConversationMessages(input.conversationId, input.ownerId),
      loadSuggestionTopics(input.ownerId, consumer),
      hasPendingAnswer(input.conversationId, input.ownerId),
    ]);
    if (pendingAnswer && conversation.suggestedQuestions.length === 4) return conversation.suggestedQuestions;
    const generationMessages = pendingAnswer ? [] : messages;
    const locale = inferSuggestionLocale(generationMessages, input.locale);
    const contextHash = suggestionContextHash({ messages: generationMessages, topics, locale, cursor: conversation.suggestionCursor });
    if (conversation.suggestionsContextHash === contextHash && conversation.suggestedQuestions.length === 4) {
      return conversation.suggestedQuestions;
    }

    let suggestedQuestions = generationMessages.length === 0
      ? buildInitialSuggestedQuestions(topics, locale, conversation.suggestionCursor)
      : buildContextualSuggestionFallback(topics, generationMessages, locale, conversation.suggestionCursor);
    const config = getRuntimeConfig();
    if (generationMessages.length > 0 && config.ai.apiKey) {
      try {
        const startedAt = performance.now();
        let completionUsage: { inputTokens: number | null; outputTokens: number | null } = { inputTokens: null, outputTokens: null };
        const aiClient = new OpenAiChatClient({ apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl, profile: config.ai.profiles.router });
        suggestedQuestions = await generateConversationSuggestedQuestions(
          { messages: generationMessages, topics, locale, cursor: conversation.suggestionCursor },
          { complete: async (prompt, options) => {
            const completion = await aiClient.complete(prompt, options);
            completionUsage = { inputTokens: completion.inputTokens, outputTokens: completion.outputTokens };
            return completion;
          } },
        );
        await recordSuccessfulAiUsage({
          pool: getPool(), ownerId: input.ownerId,
          purpose: input.mode === "preview" ? "agent.suggestions" : "public.suggestions",
          model: config.ai.profiles.router.model,
          ...completionUsage,
          latencyMs: Math.round(performance.now() - startedAt),
        });
      } catch {
        // Suggestions are supplementary; the deterministic contextual fallback must not fail a settled answer.
      }
    }
    const updated = await getPool().query<{ suggestedQuestions: string[] }>(
      `UPDATE conversations SET suggested_questions=$4::jsonb,suggestions_context_hash=$5,suggestions_updated_at=now()
       WHERE id=$1 AND owner_id=$2 AND mode=$3 AND xmin::text=$6 AND suggestion_cursor=$7
       RETURNING suggested_questions AS "suggestedQuestions"`,
      [input.conversationId, input.ownerId, input.mode, JSON.stringify(suggestedQuestions), contextHash, conversation.rowVersion, conversation.suggestionCursor],
    );
    if (updated.rows[0]) return updated.rows[0].suggestedQuestions;
  }
  throw new AppError("SUGGESTIONS_CONTEXT_CHANGED", "The conversation changed while suggestions were being generated. Refresh and try again.", 409);
}

export async function refreshConversationSuggestions(input: {
  ownerId: string;
  mode: "preview" | "public";
  locale: SuggestionLocale;
  conversationId?: string;
}) {
  const result = await getPool().query<{ id: string }>(
    `UPDATE conversations SET suggestion_cursor=(suggestion_cursor+1)%1000000,last_activity_at=now()
     WHERE id=(
       SELECT id FROM conversations WHERE owner_id=$1 AND mode=$2
         AND ($3::uuid IS NULL OR id=$3)
       ORDER BY last_activity_at DESC,id DESC LIMIT 1
     ) AND owner_id=$1 AND mode=$2
     RETURNING id`,
    [input.ownerId, input.mode, input.conversationId ?? null],
  );
  const conversation = result.rows[0];
  if (!conversation) throw new AppError("CONVERSATION_NOT_FOUND", "The conversation was not found.", 404);
  return ensureConversationSuggestions({ ...input, conversationId: conversation.id });
}
