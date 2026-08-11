import "server-only";

import { performance } from "node:perf_hooks";

import type { PoolClient } from "pg";

import { DeepSeekClient } from "@/server/ai/deepseek";
import { getRuntimeConfig } from "@/server/config";
import { getPool } from "@/server/db/client";
import { AppError, toAppError } from "@/server/errors";

import { generateGroundedAnswer } from "./answer-generator";
import type { ChatInput, FeedbackInput } from "./agent-input";
import { recoverStaleAnswers } from "./message-recovery";
import { assessAgentQuestion } from "./question-policy";
import { retrieveEvidence } from "./retrieval-service";

type ExchangeRow = {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string | null;
  assistantStatus: "pending" | "completed" | "failed" | null;
};

async function existingExchange(ownerId: string, clientMessageId: string) {
  const result = await getPool().query<ExchangeRow>(
    `SELECT conversation.id AS "conversationId",user_message.id AS "userMessageId",
            assistant.id AS "assistantMessageId",assistant.status AS "assistantStatus"
     FROM messages user_message
     JOIN conversations conversation ON conversation.id=user_message.conversation_id AND conversation.owner_id=user_message.owner_id AND conversation.mode='preview'
     LEFT JOIN messages assistant ON assistant.reply_to_message_id=user_message.id AND assistant.owner_id=user_message.owner_id
     WHERE user_message.owner_id=$1 AND user_message.client_message_id=$2 AND user_message.role='user'
     LIMIT 1`,
    [ownerId, clientMessageId],
  );
  return result.rows[0] ?? null;
}

async function ensurePreviewConversation(client: PoolClient, ownerId: string, conversationId?: string) {
  if (conversationId) {
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM conversations WHERE id=$1 AND owner_id=$2 AND mode='preview' FOR UPDATE",
      [conversationId, ownerId],
    );
    if (!existing.rows[0]) throw new AppError("CONVERSATION_NOT_FOUND", "The conversation was not found.", 404);
    return conversationId;
  }
  const created = await client.query<{ id: string }>(
    "INSERT INTO conversations(owner_id,mode) VALUES ($1,'preview') RETURNING id",
    [ownerId],
  );
  const id = created.rows[0]?.id;
  if (!id) throw new AppError("CONVERSATION_CREATE_FAILED", "The preview conversation could not be created.", 500);
  return id;
}

async function beginExchange(ownerId: string, input: ChatInput) {
  const already = await existingExchange(ownerId, input.clientMessageId);
  if (already) return { ...already, created: false as const };

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const conversationId = await ensurePreviewConversation(client, ownerId, input.conversationId);
    const userMessage = await client.query<{ id: string }>(
      `INSERT INTO messages(conversation_id,owner_id,role,status,client_message_id,content)
       VALUES ($1,$2,'user','completed',$3,$4) RETURNING id`,
      [conversationId, ownerId, input.clientMessageId, input.question],
    );
    const userMessageId = userMessage.rows[0]?.id;
    if (!userMessageId) throw new AppError("MESSAGE_CREATE_FAILED", "The question could not be stored.", 500);
    const assistantMessage = await client.query<{ id: string }>(
      `INSERT INTO messages(conversation_id,owner_id,role,status,reply_to_message_id,content)
       VALUES ($1,$2,'assistant','pending',$3,'') RETURNING id`,
      [conversationId, ownerId, userMessageId],
    );
    const assistantMessageId = assistantMessage.rows[0]?.id;
    if (!assistantMessageId) throw new AppError("MESSAGE_CREATE_FAILED", "The answer placeholder could not be stored.", 500);
    await client.query("UPDATE conversations SET last_activity_at=now() WHERE id=$1 AND owner_id=$2", [conversationId, ownerId]);
    await client.query("COMMIT");
    return { conversationId, userMessageId, assistantMessageId, assistantStatus: "pending" as const, created: true as const };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      const raced = await existingExchange(ownerId, input.clientMessageId);
      if (raced) return { ...raced, created: false as const };
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function loadPreviewThread(ownerId: string, requestedConversationId?: string) {
  const pool = getPool();
  const conversation = await pool.query<{ id: string; createdAt: Date; lastActivityAt: Date }>(
    requestedConversationId
      ? "SELECT id,created_at AS \"createdAt\",last_activity_at AS \"lastActivityAt\" FROM conversations WHERE id=$1 AND owner_id=$2 AND mode='preview' LIMIT 1"
      : "SELECT id,created_at AS \"createdAt\",last_activity_at AS \"lastActivityAt\" FROM conversations WHERE owner_id=$1 AND mode='preview' ORDER BY last_activity_at DESC,id DESC LIMIT 1",
    requestedConversationId ? [requestedConversationId, ownerId] : [ownerId],
  );
  const thread = conversation.rows[0];
  if (requestedConversationId && !thread) throw new AppError("CONVERSATION_NOT_FOUND", "The conversation was not found.", 404);
  if (!thread) return { conversation: null, messages: [] };
  await recoverStaleAnswers(thread.id, ownerId, pool);
  const actorKey = `candidate:${ownerId}`;
  const messages = await pool.query(
    `SELECT message.id,message.role,message.status,
            CASE WHEN message.source_invalidated_at IS NOT NULL OR coalesce(bool_or(citation.chunk_id IS NOT NULL AND (material.id IS NULL OR material.status<>'indexed' OR material.visibility='private')),false)
                 THEN 'This answer is no longer available because its source permissions changed.' ELSE message.content END AS content,
            message.model,
            CASE WHEN message.source_invalidated_at IS NOT NULL OR coalesce(bool_or(citation.chunk_id IS NOT NULL AND (material.id IS NULL OR material.status<>'indexed' OR material.visibility='private')),false)
                 THEN 'SOURCE_PERMISSION_CHANGED' ELSE message.error_code END AS "errorCode",
            message.reply_to_message_id AS "replyToMessageId",message.created_at AS "createdAt",
            (SELECT value FROM answer_feedback WHERE message_id=message.id AND actor_key=$3) AS feedback,
            coalesce(jsonb_agg(jsonb_build_object(
              'chunkId',citation.chunk_id,'rank',citation.rank,'excerpt',citation.excerpt,
              'materialId',material.id,'materialTitle',material.title,'materialKind',material.kind,
              'externalUrl',material.external_url,'visibility',material.visibility
            ) ORDER BY citation.rank) FILTER (WHERE citation.chunk_id IS NOT NULL AND material.status='indexed' AND material.visibility<>'private'),'[]'::jsonb) AS citations
     FROM messages message
     LEFT JOIN message_citations citation ON citation.message_id=message.id AND citation.owner_id=message.owner_id
     LEFT JOIN chunks chunk ON chunk.id=citation.chunk_id AND chunk.owner_id=citation.owner_id
     LEFT JOIN materials material ON material.id=chunk.material_id AND material.owner_id=chunk.owner_id
     WHERE message.conversation_id=$1 AND message.owner_id=$2
     GROUP BY message.id
     ORDER BY message.created_at ASC,CASE WHEN message.role='user' THEN 0 ELSE 1 END,message.id ASC`,
    [thread.id, ownerId, actorKey],
  );
  return { conversation: thread, messages: messages.rows };
}

async function persistAnswer(
  ownerId: string,
  exchange: Extract<Awaited<ReturnType<typeof beginExchange>>, { created: true }>,
  result: Awaited<ReturnType<typeof generateGroundedAnswer>>,
  model: string,
  latencyMs: number,
  requestId?: string,
) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE messages SET status='completed',content=$3,model=$4,latency_ms=$5,error_code=$6
       WHERE id=$1 AND owner_id=$2 AND status='pending'`,
      [exchange.assistantMessageId, ownerId, result.answer, result.outcome === "answered" ? model : null, latencyMs, result.outcome === "answered" ? null : result.outcome.toUpperCase()],
    );
    if (updated.rowCount !== 1) throw new AppError("ANSWER_ALREADY_SETTLED", "The answer request was already settled.", 409);
    for (const [index, citation] of result.citations.entries()) {
      await client.query(
        `INSERT INTO message_citations(message_id,chunk_id,owner_id,rank,excerpt)
         VALUES ($1,$2,$3,$4,$5)`,
        [exchange.assistantMessageId, citation.chunkId, ownerId, index + 1, citation.content.slice(0, 500)],
      );
    }
    if (result.outcome === "answered") {
      await client.query(
        `INSERT INTO ai_usage(owner_id,purpose,model,input_tokens,output_tokens,latency_ms,outcome)
         VALUES ($1,'agent.preview',$2,$3,$4,$5,'success')`,
        [ownerId, model, result.usage.inputTokens, result.usage.outputTokens, latencyMs],
      );
    }
    await client.query("UPDATE conversations SET last_activity_at=now() WHERE id=$1 AND owner_id=$2", [exchange.conversationId, ownerId]);
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','agent.preview.answer','message',$2,$3,$4,$5::jsonb)`,
      [ownerId, exchange.assistantMessageId, result.outcome, requestId ?? null, JSON.stringify({ conversationId: exchange.conversationId, citationCount: result.citations.length })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function persistAnswerFailure(
  ownerId: string,
  exchange: Extract<Awaited<ReturnType<typeof beginExchange>>, { created: true }>,
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
         VALUES ($1,'agent.preview',$2,$3,'failed',$4)`,
        [ownerId, model, latencyMs, safeError.code],
      );
    }
    await client.query("UPDATE conversations SET last_activity_at=now() WHERE id=$1 AND owner_id=$2", [exchange.conversationId, ownerId]);
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','agent.preview.answer','message',$2,'failed',$3,$4::jsonb)`,
      [ownerId, exchange.assistantMessageId, requestId ?? null, JSON.stringify({ conversationId: exchange.conversationId, errorCode: safeError.code })],
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

export async function chatPreview(ownerId: string, input: ChatInput, requestId?: string) {
  const exchange = await beginExchange(ownerId, input);
  if (!exchange.created) {
    return { ...(await loadPreviewThread(ownerId, exchange.conversationId)), idempotent: true, pending: exchange.assistantStatus === "pending" };
  }

  const config = getRuntimeConfig();
  const settingsResult = await getPool().query<{ answerTone: "professional" | "concise" | "conversational"; privacySafeMode: boolean }>(
    `SELECT answer_tone AS "answerTone",privacy_safe_mode AS "privacySafeMode" FROM agent_settings WHERE owner_id=$1`,
    [ownerId],
  );
  const settings = settingsResult.rows[0] ?? { answerTone: "professional" as const, privacySafeMode: true };
  const assessment = assessAgentQuestion(input.question);
  const evidence = assessment.allowed ? await retrieveEvidence(ownerId, "candidate_preview", { query: assessment.question, limit: 8 }) : [];
  const startedAt = performance.now();
  try {
    const result = await generateGroundedAnswer(
      input.question,
      evidence,
      settings,
      new DeepSeekClient(config.deepseek, { timeoutMs: 45_000 }),
    );
    const latencyMs = Math.round(performance.now() - startedAt);
    await persistAnswer(ownerId, exchange, result, config.deepseek.model, latencyMs, requestId);
    return { ...(await loadPreviewThread(ownerId, exchange.conversationId)), idempotent: false, pending: false };
  } catch (error) {
    return persistAnswerFailure(ownerId, exchange, error, config.deepseek.model, Math.round(performance.now() - startedAt), requestId);
  }
}

export async function saveCandidateFeedback(ownerId: string, messageId: string, input: FeedbackInput, requestId?: string) {
  const pool = getPool();
  const owned = await pool.query<{ id: string }>(
    `SELECT message.id FROM messages message
     JOIN conversations conversation ON conversation.id=message.conversation_id AND conversation.owner_id=message.owner_id
     WHERE message.id=$1 AND message.owner_id=$2 AND message.role='assistant' AND conversation.mode='preview'`,
    [messageId, ownerId],
  );
  if (!owned.rows[0]) throw new AppError("MESSAGE_NOT_FOUND", "The message was not found.", 404);
  const actorKey = `candidate:${ownerId}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const feedback = await client.query<{ value: "up" | "down" }>(
      `INSERT INTO answer_feedback(message_id,actor_key,value) VALUES ($1,$2,$3)
       ON CONFLICT (message_id,actor_key) DO UPDATE SET value=excluded.value
       RETURNING value`,
      [messageId, actorKey, input.value],
    );
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','agent.answer.feedback','message',$2,'recorded',$3,$4::jsonb)`,
      [ownerId, messageId, requestId ?? null, JSON.stringify({ value: input.value })],
    );
    await client.query("COMMIT");
    return feedback.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
