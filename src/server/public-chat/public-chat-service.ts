import "server-only";

import { performance } from "node:perf_hooks";

import { generateGroundedAnswer } from "@/server/agent/answer-generator";
import { ensureConversationSuggestions } from "@/server/agent/conversation-suggestions";
import { recordSuccessfulAiUsage } from "@/server/agent/ai-usage";
import { retrieveUnifiedEvidence } from "@/server/agent/evidence-provider";
import { answerCitationCount, persistAnswerCitations, validateAnswerEvidence } from "@/server/agent/message-evidence";
import { loadQuestionRepositories } from "@/server/agent/question-context";
import { localizedQuestionMessage } from "@/server/agent/question-language";
import { recordQuestionRoute } from "@/server/agent/question-route-audit";
import { effectiveQuestionRoute, routeQuestion, selectSourceInspectionRepository } from "@/server/agent/question-router";
import { isRepositoryEvidence } from "@/server/agent/retrieval";
import { recoverStaleAnswers } from "@/server/agent/message-recovery";
import { OpenAiChatClient } from "@/server/ai/openai-compatible";
import { queueConversationAnalysisRun } from "@/server/code-agent/analysis-runs";
import { getRuntimeConfig } from "@/server/config";
import { getPool } from "@/server/db/client";
import { AppError, toAppError } from "@/server/errors";
import { loadPlatformPolicies } from "@/server/admin/settings-service";

import type { PublicChatInput, PublicFeedbackInput } from "./public-chat-input";
import { assessPublicQuestion, isContextDependentPublicQuestion } from "./public-question-policy";
import { publicAnswerRisk } from "./public-risk";
import { consumePublicRateLimit } from "./rate-limit";
import { projectPublicCitations, type RawPublicCitation } from "./public-citation";
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

async function beginPublicExchange(conversation: PublicConversation, input: PublicChatInput, limits: { publicChatMinuteLimit: number }) {
  const already = await existingExchange(conversation.id, input.clientMessageId);
  if (already) return { ...already, created: false as const };
  await consumePublicRateLimit(`chat:minute:${conversation.id}`, limits.publicChatMinuteLimit, 60);

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

export async function loadPublicThread(slug: string, visitorToken: string | undefined, conversationId: string, locale: "en" | "zh-CN" = "en") {
  const { conversation, token } = await requirePublicConversation(slug, visitorToken, conversationId);
  await recoverStaleAnswers(conversation.id, conversation.ownerId, getPool());
  const actorKey = `visitor:${hashVisitorToken(token)}`;
  const messages = await getPool().query<{ citations: RawPublicCitation[] } & Record<string, unknown>>(
    `SELECT message.id,message.role,message.status,
            CASE WHEN message.source_invalidated_at IS NOT NULL
                   OR EXISTS (
                     SELECT 1 FROM message_citations document_citation
                     LEFT JOIN chunks document_chunk ON document_chunk.id=document_citation.chunk_id AND document_chunk.owner_id=document_citation.owner_id
                     LEFT JOIN materials document_material ON document_material.id=document_chunk.material_id AND document_material.owner_id=document_chunk.owner_id
                     WHERE document_citation.message_id=message.id AND (document_material.id IS NULL OR document_material.status<>'indexed' OR document_material.visibility NOT IN ('citation_allowed','public_preview'))
                   )
                   OR EXISTS (
                     SELECT 1 FROM repository_message_citations source
                     LEFT JOIN repositories repository ON repository.id=source.repository_id AND repository.owner_id=source.owner_id
                     LEFT JOIN repository_revisions revision ON revision.id=source.revision_id AND revision.owner_id=source.owner_id
                     WHERE source.message_id=message.id AND (repository.id IS NULL OR repository.disabled_at IS NOT NULL OR repository.visibility NOT IN ('citation_allowed','public_preview') OR revision.id IS NULL)
                   )
                 THEN 'This answer is no longer available because its source permissions changed.' ELSE message.content END AS content,
            message.model,
            CASE WHEN message.source_invalidated_at IS NOT NULL
                   OR EXISTS (
                     SELECT 1 FROM message_citations document_citation
                     LEFT JOIN chunks document_chunk ON document_chunk.id=document_citation.chunk_id AND document_chunk.owner_id=document_citation.owner_id
                     LEFT JOIN materials document_material ON document_material.id=document_chunk.material_id AND document_material.owner_id=document_chunk.owner_id
                     WHERE document_citation.message_id=message.id AND (document_material.id IS NULL OR document_material.status<>'indexed' OR document_material.visibility NOT IN ('citation_allowed','public_preview'))
                   )
                   OR EXISTS (
                     SELECT 1 FROM repository_message_citations source
                     LEFT JOIN repositories repository ON repository.id=source.repository_id AND repository.owner_id=source.owner_id
                     LEFT JOIN repository_revisions revision ON revision.id=source.revision_id AND revision.owner_id=source.owner_id
                     WHERE source.message_id=message.id AND (repository.id IS NULL OR repository.disabled_at IS NOT NULL OR repository.visibility NOT IN ('citation_allowed','public_preview') OR revision.id IS NULL)
                   )
                 THEN 'SOURCE_PERMISSION_CHANGED' ELSE message.error_code END AS "errorCode",
            message.reply_to_message_id AS "replyToMessageId",message.created_at AS "createdAt",
            (SELECT value FROM answer_feedback WHERE message_id=message.id AND actor_key=$3) AS feedback,
            (SELECT jsonb_build_object('id',run.id,'version',run.version,'state',run.state,'phase',run.phase)
             FROM analysis_runs run WHERE run.assistant_message_id=message.id AND run.owner_id=message.owner_id
             ORDER BY run.created_at DESC,run.id DESC LIMIT 1) AS "analysisRun",
            coalesce((
              SELECT jsonb_agg(item.payload ORDER BY item.rank) FROM (
                SELECT citation.rank,jsonb_build_object(
                  'kind','document','chunkId',citation.chunk_id,'rank',citation.rank,
                  'materialId',material.id,'contentChecksum',material.content_checksum,'materialTitle',material.title,'materialKind',material.kind,
                  'mimeType',material.mime_type,'externalUrl',material.external_url,'visibility',material.visibility
                ) AS payload
                FROM message_citations citation
                JOIN chunks chunk ON chunk.id=citation.chunk_id AND chunk.owner_id=citation.owner_id
                JOIN materials material ON material.id=chunk.material_id AND material.owner_id=chunk.owner_id
                WHERE citation.message_id=message.id AND material.status='indexed' AND material.visibility IN ('citation_allowed','public_preview')
                UNION ALL
                SELECT source.rank,jsonb_build_object(
                  'kind','repository','messageId',source.message_id,'rank',source.rank,'repositoryId',repository.id,
                  'repositoryTitle',repository.display_name,'revisionId',revision.id,'commitSha',revision.commit_sha,
                  'path',source.path,'lineStart',source.line_start,'lineEnd',source.line_end,'visibility',repository.visibility
                ) AS payload
                FROM repository_message_citations source
                JOIN repositories repository ON repository.id=source.repository_id AND repository.owner_id=source.owner_id AND repository.disabled_at IS NULL
                JOIN repository_revisions revision ON revision.id=source.revision_id AND revision.owner_id=source.owner_id
                WHERE source.message_id=message.id AND repository.visibility IN ('citation_allowed','public_preview')
              ) item
            ),'[]'::jsonb) AS citations
     FROM messages message
     WHERE message.conversation_id=$1 AND message.owner_id=$2
     ORDER BY message.created_at ASC,CASE WHEN message.role='user' THEN 0 ELSE 1 END,message.id ASC`,
    [conversation.id, conversation.ownerId, actorKey],
  );
  const suggestedQuestions = await ensureConversationSuggestions({ conversationId: conversation.id, ownerId: conversation.ownerId, mode: "public", locale });
  return {
    conversation: { id: conversation.id, expiresAt: conversation.expiresAt },
    messages: messages.rows.map((message) => ({ ...message, citations: projectPublicCitations(slug, conversation.id, message.citations) })),
    suggestedQuestions,
  };
}

type AnswerResult =
  | Awaited<ReturnType<typeof generateGroundedAnswer>>
  | { outcome: "refused"; answer: string; refusalCode: string; citations: []; usage: { inputTokens: number | null; outputTokens: number | null } };

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
    if (result.outcome === "answered") await validateAnswerEvidence(client, ownerId, "public_answer", result.citations);
    const errorCode = result.outcome === "answered" ? null : result.outcome === "refused" ? result.refusalCode : "INSUFFICIENT_EVIDENCE";
    const updated = await client.query(
      `UPDATE messages SET status='completed',content=$3,model=$4,latency_ms=$5,error_code=$6
       WHERE id=$1 AND owner_id=$2 AND status='pending'`,
      [exchange.assistantMessageId, ownerId, result.answer, result.outcome === "answered" ? model : null, latencyMs, errorCode],
    );
    if (updated.rowCount !== 1) throw new AppError("ANSWER_ALREADY_SETTLED", "The answer request was already settled.", 409);
    await persistAnswerCitations(client, ownerId, exchange.assistantMessageId, result.citations);
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
      [exchange.assistantMessageId, result.outcome, requestId ?? null, JSON.stringify({ publicationId, conversationId: exchange.conversationId, citationCount: answerCitationCount(result.citations) })],
    );
    const risk = publicAnswerRisk(result.outcome, errorCode, answerCitationCount(result.citations));
    if (risk) {
      await client.query(
        `INSERT INTO content_flags(publication_id,message_id,category,severity,safe_summary)
         VALUES ($1,$2,$3,$4::flag_severity,$5) ON CONFLICT DO NOTHING`,
        [publicationId, exchange.assistantMessageId, risk.category, risk.severity, risk.safeSummary],
      );
    }
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
): Promise<never> {
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
  const { publication, conversation, token } = await requirePublicConversation(slug, visitorToken, input.conversationId);
  const policies = await loadPlatformPolicies();
  const exchange = await beginPublicExchange(conversation, input, policies);
  if (!exchange.created || !exchange.assistantMessageId) {
    return { ...(await loadPublicThread(slug, visitorToken, conversation.id)), idempotent: true, pending: exchange.assistantStatus === "pending" };
  }
  const createdExchange = { ...exchange, created: true as const, assistantMessageId: exchange.assistantMessageId };
  const startedAt = performance.now();
  let failureModel = "unconfigured";
  try {
    const config = getRuntimeConfig();
    failureModel = config.ai.profiles.router.model;
    const previousQuestions = await priorAllowedQuestions(conversation.id, exchange.userMessageId);
    const assessment = assessPublicQuestion(input.question);
    let evidence = assessment.allowed
      ? await retrieveUnifiedEvidence(getPool(), conversation.ownerId, "public_answer", { query: assessment.question, limit: 8 })
      : [];
    if (
      assessment.allowed
      && evidence.length === 0
      && isContextDependentPublicQuestion(input.question)
      && previousQuestions.at(-1)
    ) {
      evidence = await retrieveUnifiedEvidence(getPool(), conversation.ownerId, "public_answer", { query: previousQuestions.at(-1)!, limit: 8 });
    }
    const settingsResult = await getPool().query<{ answerTone: "professional" | "concise" | "conversational"; privacySafeMode: boolean }>(
      "SELECT answer_tone AS \"answerTone\",privacy_safe_mode AS \"privacySafeMode\" FROM agent_settings WHERE owner_id=$1",
      [conversation.ownerId],
    );
    const settings = settingsResult.rows[0] ?? { answerTone: "professional" as const, privacySafeMode: true };
    if (assessment.allowed) {
      const repositories = await loadQuestionRepositories({
        pool: getPool(), config, ownerId: conversation.ownerId, mode: "public",
        publicationId: publication.publicationId, visitorKey: hashVisitorToken(token),
      });
      const routerStartedAt = performance.now();
      const decision = await routeQuestion({
        question: assessment.question,
        evidenceSummaries: evidence.map((item) => isRepositoryEvidence(item) ? `${item.repositoryTitle}: ${item.content}` : `${item.materialTitle}: ${item.content}`),
        repositories,
      }, new OpenAiChatClient({ apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl, profile: config.ai.profiles.router }));
      await recordSuccessfulAiUsage({ pool: getPool(), ownerId: conversation.ownerId, purpose: "public.router", model: config.ai.profiles.router.model, ...decision.usage, latencyMs: Math.round(performance.now() - routerStartedAt) });
      const sourceInspectionRepository = selectSourceInspectionRepository(assessment.question, repositories);
      const selected = sourceInspectionRepository ?? (decision.repositoryId ? repositories.find((repository) => repository.id === decision.repositoryId) : null);
      const effectiveRoute = effectiveQuestionRoute(decision, selected ?? null, sourceInspectionRepository !== null);
      await recordQuestionRoute(getPool(), {
        ownerId: conversation.ownerId, actorRole: "interviewer", conversationId: conversation.id,
        requestedRoute: decision.route, effectiveRoute,
        reasonCode: sourceInspectionRepository ? "source_inspection_required" : decision.route === "deep" && effectiveRoute !== "deep" ? "low_confidence_rag_fallback" : decision.route === "refuse" && effectiveRoute !== "refuse" ? "router_refuse_not_deterministic" : decision.reasonCode,
        confidence: decision.confidence, repositoryId: selected?.id ?? decision.repositoryId, evidenceCount: evidence.length, requestId,
      });
      if (effectiveRoute === "deep" && selected) {
        const run = await queueConversationAnalysisRun({
          pool: getPool(), config, ownerId: conversation.ownerId, repositoryId: selected.id,
          conversationId: conversation.id, assistantMessageId: createdExchange.assistantMessageId,
          clientMessageId: input.clientMessageId, actorRole: "interviewer", requestId,
        });
        return { ...(await loadPublicThread(slug, token, conversation.id)), idempotent: false, pending: true, analysisRun: run };
      }
      if (effectiveRoute === "refuse") {
        const result: AnswerResult = {
          outcome: "refused",
          answer: decision.reasonCode === "deep_analysis_not_allowed"
            ? localizedQuestionMessage(input.question, { en: "Deep Repository analysis is not enabled for this public Agent. I can answer from approved public evidence when available.", zh: "这个公开 Agent 没有启用深度代码仓库分析；如果存在已批准的公开证据，我仍可以据此回答。" })
            : localizedQuestionMessage(input.question, { en: "I cannot answer that request within this public Agent's authorized career evidence.", zh: "该请求超出了这个公开 Agent 的授权职业证据范围，我无法回答。" }),
          refusalCode: decision.reasonCode === "deep_analysis_not_allowed" ? "DEEP_ANALYSIS_NOT_ALLOWED" : "QUESTION_OUT_OF_SCOPE",
          citations: [],
          usage: decision.usage,
        };
        await persistPublicAnswer(conversation.ownerId, publication.publicationId, createdExchange, result, config.ai.profiles.router.model, Math.round(performance.now() - startedAt), requestId);
        return { ...(await loadPublicThread(slug, token, conversation.id)), idempotent: false, pending: false };
      }
    }
    failureModel = config.ai.profiles.rag.model;
    const result: AnswerResult = assessment.allowed
      ? await generateGroundedAnswer(
          input.question,
          evidence,
          settings,
          new OpenAiChatClient({ apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl, profile: config.ai.profiles.rag }),
          previousQuestions.map((question) => ({ role: "user" as const, content: question })),
        )
      : { outcome: "refused", answer: assessment.message, refusalCode: assessment.code, citations: [], usage: { inputTokens: null, outputTokens: null } };
    if (result.outcome === "insufficient_evidence" && assessment.allowed) {
      const repositories = await loadQuestionRepositories({
        pool: getPool(), config, ownerId: conversation.ownerId, mode: "public",
        publicationId: publication.publicationId, visitorKey: hashVisitorToken(token),
      });
      if (repositories.length === 1 && repositories[0]!.deepAllowed) {
        await recordQuestionRoute(getPool(), {
          ownerId: conversation.ownerId, actorRole: "interviewer", conversationId: conversation.id,
          requestedRoute: "rag", effectiveRoute: "deep", reasonCode: "rag_insufficient_single_repository",
          confidence: 1, repositoryId: repositories[0]!.id, evidenceCount: evidence.length, requestId,
        });
        const run = await queueConversationAnalysisRun({
          pool: getPool(), config, ownerId: conversation.ownerId, repositoryId: repositories[0]!.id,
          conversationId: conversation.id, assistantMessageId: createdExchange.assistantMessageId,
          clientMessageId: input.clientMessageId, actorRole: "interviewer", requestId,
        });
        return { ...(await loadPublicThread(slug, token, conversation.id)), idempotent: false, pending: true, analysisRun: run };
      }
    }
    await persistPublicAnswer(conversation.ownerId, publication.publicationId, createdExchange, result, config.ai.profiles.rag.model, Math.round(performance.now() - startedAt), requestId);
    return { ...(await loadPublicThread(slug, visitorToken, conversation.id)), idempotent: false, pending: false };
  } catch (error) {
    return persistPublicFailure(conversation.ownerId, publication.publicationId, createdExchange, error, failureModel, Math.round(performance.now() - startedAt), requestId);
  }
}

export async function savePublicFeedback(slug: string, visitorToken: string | undefined, conversationId: string, messageId: string, input: PublicFeedbackInput, requestId?: string) {
  const { publication, conversation, token } = await requirePublicConversation(slug, visitorToken, conversationId);
  const policies = await loadPlatformPolicies();
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
    if (policies.negativeFeedbackAutoFlag && input.value === "down" && previous.rows[0]?.value !== "down") {
      await client.query(
        `INSERT INTO content_flags(publication_id,message_id,category,severity,safe_summary)
         VALUES ($1,$2,'visitor_negative_feedback','low','An anonymous visitor marked a public Agent answer as unhelpful.')
         ON CONFLICT DO NOTHING`,
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
