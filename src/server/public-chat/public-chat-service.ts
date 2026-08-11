import "server-only";

import { performance } from "node:perf_hooks";

import { generateGroundedAnswer } from "@/server/agent/answer-generator";
import { recoverStaleAnswers } from "@/server/agent/message-recovery";
import { DeepSeekClient } from "@/server/ai/deepseek";
import { getRuntimeConfig } from "@/server/config";
import { getPool } from "@/server/db/client";
import { AppError, toAppError } from "@/server/errors";

import type { PublicChatInput, PublicFeedbackInput } from "./public-chat-input";
import { assessPublicQuestion, isContextDependentPublicQuestion } from "./public-question-policy";
import { retrievePublicQuestionEvidence } from "./public-retrieval";
import { consumePublicRateLimit } from "./rate-limit";
import { requirePublicConversation, type PublicConversation } from "./session-service";
import { hashVisitorToken } from "./visitor-credential";

type PublicExchange = {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string | null;
  assistantStatus: "pending" | "completed" | "failed" | null;
  created: boolean;
};

async function existingExchange(conversationId: string, clientMessageId: string) {
  const result = await getPool().query<Omit<PublicExchange, "created">>(
    `SELECT user_message.conversation_id AS "conversationId",user_message.id AS "userMessageId",
            assistant.id AS "assistantMessageId",assistant.status AS "assistantStatus"
     FROM messages user_message
     LEFT JOIN messages assistant ON assistant.reply_to_message_id=user_message.id AND assistant.owner_id=user_message.owner_id
     WHERE user_message.conversation_id=$1 AND user_message.client_message_id=$2 AND user_message.role='user'
     LIMIT 1`,
    [conversationId, clientMessageId],
  );
  return result.rows[0] ?? null;
}

async function beginPublicExchange(conversation: PublicConversation, input: PublicChatInput) {
  const already = await existingExchange(conversation.id, input.clientMessageId);
  if (already) return { ...already, created: false as const };
  await consumePublicRateLimit(`chat:minute:${conversation.id}`, 10, 60);
  await consumePublicRateLimit(`chat:day:${conversation.id}`, 100, 86_400);

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const active = await client.query(
      "SELECT id FROM conversations WHERE id=$1 AND owner_id=$2 AND mode='public' AND expires_at>now() FOR UPDATE",
      [conversation.id, conversation.ownerId],
    );
    if (!active.rows[0]) throw new AppError("PUBLIC_SESSION_REQUIRED", "Start a public Agent session first.", 401);
    const userMessage = await client.query<{ id: string }>(
      `INSERT INTO messages(conversation_id,owner_id,role,status,client_message_id,content)
       VALUES ($1,$2,'user','completed',$3,$4) RETURNING id`,
      [conversation.id, conversation.ownerId, input.clientMessageId, input.question],
    );
    const userMessageId = userMessage.rows[0]!.id;
    const assistantMessage = await client.query<{ id: string }>(
      `INSERT INTO messages(conversation_id,owner_id,role,status,reply_to_message_id,content)
       VALUES ($1,$2,'assistant','pending',$3,'') RETURNING id`,
      [conversation.id, conversation.ownerId, userMessageId],
    );
    const assistantMessageId = assistantMessage.rows[0]!.id;
    await client.query("UPDATE conversations SET last_activity_at=now() WHERE id=$1", [conversation.id]);
    await client.query("COMMIT");
    return { conversationId: conversation.id, userMessageId, assistantMessageId, assistantStatus: "pending" as const, created: true as const };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      const raced = await existingExchange(conversation.id, input.clientMessageId);
      if (raced) return { ...raced, created: false as const };
    }
    throw error;
  } finally {
    client.release();
  }
}

async function priorAllowedQuestions(conversationId: string, currentMessageId: string) {
  const result = await getPool().query<{ content: string }>(
    `SELECT content FROM messages
     WHERE conversation_id=$1 AND role='user' AND status='completed' AND id<>$2
     ORDER BY created_at DESC,id DESC LIMIT 3`,
    [conversationId, currentMessageId],
  );
  return result.rows
    .map((row) => assessPublicQuestion(row.content))
    .filter((assessment): assessment is Extract<typeof assessment, { allowed: true }> => assessment.allowed)
    .map((assessment) => assessment.question)
    .reverse();
}

export async function loadPublicThread(slug: string, visitorToken: string | undefined) {
  const { conversation, token } = await requirePublicConversation(slug, visitorToken);
  await recoverStaleAnswers(conversation.id, conversation.ownerId, getPool());
  const actorKey = `visitor:${hashVisitorToken(token)}`;
  const messages = await getPool().query(
    `SELECT message.id,message.role,message.status,
            CASE WHEN message.source_invalidated_at IS NOT NULL OR coalesce(bool_or(citation.chunk_id IS NOT NULL AND (material.id IS NULL OR material.status<>'indexed' OR material.visibility NOT IN ('citation_allowed','public_preview'))),false)
                 THEN 'This answer is no longer available because its source permissions changed.' ELSE message.content END AS content,
            message.model,
            CASE WHEN message.source_invalidated_at IS NOT NULL OR coalesce(bool_or(citation.chunk_id IS NOT NULL AND (material.id IS NULL OR material.status<>'indexed' OR material.visibility NOT IN ('citation_allowed','public_preview'))),false)
                 THEN 'SOURCE_PERMISSION_CHANGED' ELSE message.error_code END AS "errorCode",
            message.reply_to_message_id AS "replyToMessageId",message.created_at AS "createdAt",
            (SELECT value FROM answer_feedback WHERE message_id=message.id AND actor_key=$3) AS feedback,
            coalesce(jsonb_agg(jsonb_build_object(
              'chunkId',citation.chunk_id,'rank',citation.rank,'excerpt',citation.excerpt,
              'materialId',material.id,'materialTitle',material.title,'materialKind',material.kind,'externalUrl',material.external_url
            ) ORDER BY citation.rank) FILTER (
              WHERE citation.chunk_id IS NOT NULL AND material.status='indexed' AND material.visibility IN ('citation_allowed','public_preview')
            ),'[]'::jsonb) AS citations
     FROM messages message
     LEFT JOIN message_citations citation ON citation.message_id=message.id AND citation.owner_id=message.owner_id
     LEFT JOIN chunks chunk ON chunk.id=citation.chunk_id AND chunk.owner_id=citation.owner_id
     LEFT JOIN materials material ON material.id=chunk.material_id AND material.owner_id=chunk.owner_id
     WHERE message.conversation_id=$1 AND message.owner_id=$2
     GROUP BY message.id
     ORDER BY message.created_at ASC,CASE WHEN message.role='user' THEN 0 ELSE 1 END,message.id ASC`,
    [conversation.id, conversation.ownerId, actorKey],
  );
  return { conversation: { id: conversation.id, expiresAt: conversation.expiresAt }, messages: messages.rows };
}

type AnswerResult =
  | Awaited<ReturnType<typeof generateGroundedAnswer>>
  | { outcome: "refused"; answer: string; refusalCode: string; citations: []; usage: { inputTokens: null; outputTokens: null } };

async function persistPublicAnswer(
  ownerId: string,
  publicationId: string,
  exchange: PublicExchange & { created: true; assistantMessageId: string },
  result: AnswerResult,
  model: string,
  latencyMs: number,
  requestId?: string,
) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (result.outcome === "answered") {
      const allowed = await client.query<{ id: string }>(
        `SELECT chunk.id FROM chunks chunk
         JOIN materials material ON material.id=chunk.material_id AND material.owner_id=chunk.owner_id
         WHERE chunk.owner_id=$1 AND chunk.id=ANY($2::uuid[]) AND material.status='indexed'
           AND material.visibility IN ('citation_allowed','public_preview')`,
        [ownerId, result.citations.map((citation) => citation.chunkId)],
      );
      if (allowed.rows.length !== result.citations.length) {
        throw new AppError("SOURCE_PERMISSION_CHANGED", "Source permissions changed while the answer was generated. Retry the question.", 409);
      }
    }
    const errorCode = result.outcome === "answered" ? null : result.outcome === "refused" ? result.refusalCode : "INSUFFICIENT_EVIDENCE";
    const updated = await client.query(
      `UPDATE messages SET status='completed',content=$3,model=$4,latency_ms=$5,error_code=$6
       WHERE id=$1 AND owner_id=$2 AND status='pending'`,
      [exchange.assistantMessageId, ownerId, result.answer, result.outcome === "answered" ? model : null, latencyMs, errorCode],
    );
    if (updated.rowCount !== 1) throw new AppError("ANSWER_ALREADY_SETTLED", "The answer request was already settled.", 409);
    for (const [index, citation] of result.citations.entries()) {
      await client.query(
        "INSERT INTO message_citations(message_id,chunk_id,owner_id,rank,excerpt) VALUES ($1,$2,$3,$4,$5)",
        [exchange.assistantMessageId, citation.chunkId, ownerId, index + 1, citation.content.slice(0, 500)],
      );
    }
    if (result.outcome === "answered") {
      await client.query(
        `INSERT INTO ai_usage(owner_id,purpose,model,input_tokens,output_tokens,latency_ms,outcome)
         VALUES ($1,'public.chat',$2,$3,$4,$5,'success')`,
        [ownerId, model, result.usage.inputTokens, result.usage.outputTokens, latencyMs],
      );
    }
    await client.query("UPDATE conversations SET last_activity_at=now() WHERE id=$1", [exchange.conversationId]);
    await client.query(
      `INSERT INTO audit_events(actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ('interviewer','public.chat.answer','message',$1,$2,$3,$4::jsonb)`,
      [exchange.assistantMessageId, result.outcome, requestId ?? null, JSON.stringify({ publicationId, conversationId: exchange.conversationId, citationCount: result.citations.length })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function persistPublicFailure(
  ownerId: string,
  publicationId: string,
  exchange: PublicExchange & { created: true; assistantMessageId: string },
  error: unknown,
  model: string,
  latencyMs: number,
  requestId?: string,
) {
  const safeError = toAppError(error);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE messages SET status='failed',content=$3,model=$4,latency_ms=$5,error_code=$6
       WHERE id=$1 AND owner_id=$2 AND status='pending'`,
      [exchange.assistantMessageId, ownerId, safeError.message, model, latencyMs, safeError.code],
    );
    if (safeError.code.startsWith("AI_")) {
      await client.query(
        `INSERT INTO ai_usage(owner_id,purpose,model,latency_ms,outcome,error_code)
         VALUES ($1,'public.chat',$2,$3,'failed',$4)`,
        [ownerId, model, latencyMs, safeError.code],
      );
    }
    await client.query(
      `INSERT INTO audit_events(actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ('interviewer','public.chat.answer','message',$1,'failed',$2,$3::jsonb)`,
      [exchange.assistantMessageId, requestId ?? null, JSON.stringify({ publicationId, conversationId: exchange.conversationId, errorCode: safeError.code })],
    );
    await client.query("COMMIT");
  } catch (persistError) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw persistError;
  } finally {
    client.release();
  }
  throw safeError;
}

export async function chatPublicAgent(slug: string, visitorToken: string | undefined, input: PublicChatInput, requestId?: string) {
  const { publication, conversation } = await requirePublicConversation(slug, visitorToken);
  const exchange = await beginPublicExchange(conversation, input);
  if (!exchange.created || !exchange.assistantMessageId) {
    return { ...(await loadPublicThread(slug, visitorToken)), idempotent: true, pending: exchange.assistantStatus === "pending" };
  }
  const createdExchange = { ...exchange, created: true as const, assistantMessageId: exchange.assistantMessageId };
  const previousQuestions = await priorAllowedQuestions(conversation.id, exchange.userMessageId);
  const retrieval = await retrievePublicQuestionEvidence(conversation.ownerId, input.question);
  if (
    retrieval.assessment.allowed
    && retrieval.evidence.length === 0
    && isContextDependentPublicQuestion(input.question)
    && previousQuestions.at(-1)
  ) {
    retrieval.evidence = (await retrievePublicQuestionEvidence(conversation.ownerId, previousQuestions.at(-1)!)).evidence;
  }
  const config = getRuntimeConfig();
  const settingsResult = await getPool().query<{ answerTone: "professional" | "concise" | "conversational"; privacySafeMode: boolean }>(
    "SELECT answer_tone AS \"answerTone\",privacy_safe_mode AS \"privacySafeMode\" FROM agent_settings WHERE owner_id=$1",
    [conversation.ownerId],
  );
  const settings = settingsResult.rows[0] ?? { answerTone: "professional" as const, privacySafeMode: true };
  const startedAt = performance.now();
  try {
    const result: AnswerResult = retrieval.assessment.allowed
      ? await generateGroundedAnswer(
          input.question,
          retrieval.evidence,
          settings,
          new DeepSeekClient(config.deepseek, { timeoutMs: 45_000 }),
          previousQuestions.map((question) => ({ role: "user" as const, content: question })),
        )
      : { outcome: "refused", answer: retrieval.assessment.message, refusalCode: retrieval.assessment.code, citations: [], usage: { inputTokens: null, outputTokens: null } };
    await persistPublicAnswer(conversation.ownerId, publication.publicationId, createdExchange, result, config.deepseek.model, Math.round(performance.now() - startedAt), requestId);
    return { ...(await loadPublicThread(slug, visitorToken)), idempotent: false, pending: false };
  } catch (error) {
    return persistPublicFailure(conversation.ownerId, publication.publicationId, createdExchange, error, config.deepseek.model, Math.round(performance.now() - startedAt), requestId);
  }
}

export async function savePublicFeedback(slug: string, visitorToken: string | undefined, messageId: string, input: PublicFeedbackInput, requestId?: string) {
  const { publication, conversation, token } = await requirePublicConversation(slug, visitorToken);
  await consumePublicRateLimit(`feedback:${conversation.id}`, 30, 60);
  const actorKey = `visitor:${hashVisitorToken(token)}`;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query(
      `SELECT id FROM messages WHERE id=$1 AND conversation_id=$2 AND owner_id=$3 AND role='assistant' AND status='completed' FOR UPDATE`,
      [messageId, conversation.id, conversation.ownerId],
    );
    if (!owned.rows[0]) throw new AppError("MESSAGE_NOT_FOUND", "The message was not found.", 404);
    const previous = await client.query<{ value: "up" | "down" }>("SELECT value FROM answer_feedback WHERE message_id=$1 AND actor_key=$2", [messageId, actorKey]);
    const feedback = await client.query<{ value: "up" | "down" }>(
      `INSERT INTO answer_feedback(message_id,actor_key,value) VALUES ($1,$2,$3)
       ON CONFLICT (message_id,actor_key) DO UPDATE SET value=excluded.value RETURNING value`,
      [messageId, actorKey, input.value],
    );
    if (input.value === "down" && previous.rows[0]?.value !== "down") {
      await client.query(
        `INSERT INTO content_flags(publication_id,message_id,category,severity,safe_summary)
         VALUES ($1,$2,'visitor_negative_feedback','low','An anonymous visitor marked a public Agent answer as unhelpful.')`,
        [publication.publicationId, messageId],
      );
    }
    await client.query(
      `INSERT INTO audit_events(actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ('interviewer','public.answer.feedback','message',$1,'recorded',$2,$3::jsonb)`,
      [messageId, requestId ?? null, JSON.stringify({ publicationId: publication.publicationId, value: input.value })],
    );
    await client.query("COMMIT");
    return feedback.rows[0]!;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
