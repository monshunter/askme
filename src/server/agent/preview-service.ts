import "server-only";

import { performance } from "node:perf_hooks";

import type { PoolClient } from "pg";

import { OpenAiChatClient } from "@/server/ai/openai-compatible";
import { queueConversationAnalysisRun } from "@/server/code-agent/analysis-runs";
import { getRuntimeConfig } from "@/server/config";
import { getPool } from "@/server/db/client";
import { AppError, toAppError } from "@/server/errors";

import type { AnswerConversationMessage } from "./answer-generator";
import { deduplicateDocumentSources } from "./citation-dedup";
import { ensureConversationSuggestions } from "./conversation-suggestions";
import { recordSuccessfulAiUsage } from "./ai-usage";
import type { ChatInput, FeedbackInput } from "./agent-input";
import { recoverStaleAnswers } from "./message-recovery";
import { assessAgentQuestion } from "./question-policy";
import { loadQuestionRepositories } from "./question-context";
import { localizedQuestionMessage } from "./question-language";
import { recordQuestionRoute } from "./question-route-audit";
import { effectiveQuestionRoute, hostEntityGateRoute, routeQuestion, selectInsufficientEvidenceRepository, selectSourceInspectionRepository } from "./question-router";
import { answerRagCitationCount, generateVerifiedRagAnswer, persistRagAnswerCitations, validateRagEvidence } from "@/server/rag/rag-answer";
import { retrieveRagForQuestion } from "@/server/rag/rag-query-service";
import { uniquelyResolvedRepositoryId } from "@/server/rag/entity-catalog";
import { persistRetrievalTrace } from "@/server/rag/retrieval-trace";

type ExchangeRow = {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string | null;
  assistantStatus: "pending" | "completed" | "failed" | null;
};

type PreviewAnswerResult = Awaited<ReturnType<typeof generateVerifiedRagAnswer>> | {
  outcome: "refused";
  answer: string;
  refusalCode: string;
  citations: [];
  usage: { inputTokens: number | null; outputTokens: number | null };
};

async function priorConversationMessages(conversationId: string, currentUserMessageId: string): Promise<AnswerConversationMessage[]> {
  const result = await getPool().query<AnswerConversationMessage>(
    `SELECT role,content FROM (
       SELECT message.role,message.content,message.created_at,message.id
       FROM messages message
       JOIN messages current ON current.id=$2 AND current.conversation_id=message.conversation_id AND current.owner_id=message.owner_id
       WHERE message.conversation_id=$1 AND message.status='completed'
         AND (message.created_at<current.created_at OR (message.created_at=current.created_at AND message.id<>current.id))
       ORDER BY message.created_at DESC,message.id DESC LIMIT 6
     ) context ORDER BY created_at,id`,
    [conversationId, currentUserMessageId],
  );
  return result.rows;
}

type RawPreviewDocumentCitation = {
  kind: "document";
  materialId: string;
  contentChecksum: string | null;
  rank: number;
} & Record<string, unknown>;

type RawPreviewRepositoryCitation = {
  kind: "repository";
  rank: number;
} & Record<string, unknown>;

type RawPreviewCitation = RawPreviewDocumentCitation | RawPreviewRepositoryCitation;

const invalidPreviewRagCitation = `EXISTS (
  SELECT 1 FROM rag_message_citations rag_citation
  LEFT JOIN rag_child_chunks rag_child ON rag_child.id=rag_citation.evidence_id AND rag_child.owner_id=rag_citation.owner_id
    AND rag_child.index_version_id=rag_citation.index_version_id AND rag_child.source_version_id=rag_citation.source_version_id
    AND rag_child.content_checksum=rag_citation.content_checksum
  LEFT JOIN rag_source_versions rag_source ON rag_source.id=rag_citation.source_version_id AND rag_source.owner_id=rag_citation.owner_id
    AND rag_source.index_version_id=rag_citation.index_version_id
  LEFT JOIN rag_index_versions rag_version ON rag_version.id=rag_citation.index_version_id
  LEFT JOIN materials rag_material ON rag_source.source_kind='material' AND rag_material.id=rag_source.source_id AND rag_material.owner_id=rag_source.owner_id
  LEFT JOIN repositories rag_repository ON rag_source.source_kind<>'material' AND rag_repository.id::text=coalesce(rag_source.metadata->>'repositoryId',rag_source.source_id::text)
    AND rag_repository.owner_id=rag_source.owner_id
  LEFT JOIN repository_revisions rag_revision ON rag_revision.id=rag_repository.active_revision_id AND rag_revision.owner_id=rag_repository.owner_id
  WHERE rag_citation.message_id=message.id AND (
    rag_child.id IS NULL OR rag_source.state<>'active' OR rag_version.state<>'active'
    OR (rag_source.source_kind='material' AND (rag_material.id IS NULL OR rag_material.status<>'indexed' OR rag_material.visibility='private' OR rag_material.content_checksum<>rag_source.source_revision))
    OR (rag_source.source_kind<>'material' AND (rag_repository.id IS NULL OR rag_repository.disabled_at IS NOT NULL OR rag_repository.visibility='private'
      OR (rag_source.source_kind IN ('repository_markdown','repository_pdf') AND (rag_revision.id IS NULL OR rag_revision.commit_sha<>rag_source.metadata->>'commitSha'))))
    OR (rag_source.source_kind='approved_wiki' AND NOT EXISTS (
      SELECT 1 FROM repository_dossiers dossier
      JOIN repository_dossier_projections projection ON projection.id=rag_repository.active_projection_id AND projection.dossier_id=dossier.id AND projection.state='approved'
      JOIN repository_wiki_pages page ON page.id=rag_source.source_id AND page.dossier_id=dossier.id
      JOIN repository_wiki_projection_pages projected ON projected.projection_id=projection.id AND projected.page_id=page.id AND projected.dossier_id=dossier.id
      WHERE dossier.revision_id=rag_repository.active_revision_id AND dossier.owner_id=rag_repository.owner_id
    ))
  )
)`;

function projectPreviewCitations(citations: RawPreviewCitation[]) {
  const documents = deduplicateDocumentSources(citations.filter((citation): citation is RawPreviewDocumentCitation => citation.kind === "document"));
  return [...documents, ...citations.filter((citation): citation is RawPreviewRepositoryCitation => citation.kind === "repository")]
    .sort((left, right) => left.rank - right.rank)
    .map((citation, index) => {
      if (citation.kind === "repository") return { ...citation, rank: index + 1 };
      const projected: Record<string, unknown> = { ...citation };
      Reflect.deleteProperty(projected, "contentChecksum");
      return { ...projected, rank: index + 1 };
    });
}

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
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`preview:${ownerId}`]);
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

async function ensureLatestPreviewConversation(ownerId: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`preview:${ownerId}`]);
    const existing = await client.query<{ id: string; createdAt: Date; lastActivityAt: Date }>(
      `SELECT id,created_at AS "createdAt",last_activity_at AS "lastActivityAt"
       FROM conversations WHERE owner_id=$1 AND mode='preview' ORDER BY last_activity_at DESC,id DESC LIMIT 1`,
      [ownerId],
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return existing.rows[0];
    }
    const created = await client.query<{ id: string; createdAt: Date; lastActivityAt: Date }>(
      `INSERT INTO conversations(owner_id,mode) VALUES ($1,'preview')
       RETURNING id,created_at AS "createdAt",last_activity_at AS "lastActivityAt"`,
      [ownerId],
    );
    await client.query("COMMIT");
    return created.rows[0]!;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function resetPreviewConversations(ownerId: string, requestId?: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`preview:${ownerId}`]);
    await client.query<{ id: string }>(
      "SELECT id FROM conversations WHERE owner_id=$1 AND mode='preview' ORDER BY id FOR UPDATE",
      [ownerId],
    );
    const activeRun = await client.query<{ id: string }>(
      `SELECT run.id FROM analysis_runs run
       JOIN conversations conversation ON conversation.id=run.conversation_id AND conversation.owner_id=run.owner_id
       WHERE conversation.owner_id=$1 AND conversation.mode='preview' AND run.state IN ('pending','running')
       LIMIT 1 FOR UPDATE OF run`,
      [ownerId],
    );
    if (activeRun.rows[0]) {
      throw new AppError("PREVIEW_SESSION_BUSY", "Wait for the current deep analysis to finish before resetting the preview conversation.", 409);
    }
    const pendingAnswer = await client.query<{ id: string }>(
      `SELECT message.id FROM messages message
       JOIN conversations conversation ON conversation.id=message.conversation_id AND conversation.owner_id=message.owner_id
       WHERE conversation.owner_id=$1 AND conversation.mode='preview' AND message.role='assistant' AND message.status='pending'
       LIMIT 1 FOR UPDATE OF message`,
      [ownerId],
    );
    if (pendingAnswer.rows[0]) {
      throw new AppError("PREVIEW_SESSION_BUSY", "Wait for the current answer to finish before resetting the preview conversation.", 409);
    }
    const deleted = await client.query<{ id: string }>(
      "DELETE FROM conversations WHERE owner_id=$1 AND mode='preview' RETURNING id",
      [ownerId],
    );
    const created = await client.query<{ id: string }>(
      "INSERT INTO conversations(owner_id,mode) VALUES ($1,'preview') RETURNING id",
      [ownerId],
    );
    const conversationId = created.rows[0]?.id;
    if (!conversationId) throw new AppError("CONVERSATION_CREATE_FAILED", "The preview conversation could not be created.", 500);
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','agent.preview.reset','conversation',$2,'reset',$3,$4::jsonb)`,
      [ownerId, conversationId, requestId ?? null, JSON.stringify({ resetCount: deleted.rows.length })],
    );
    await client.query("COMMIT");
    return { conversationId, resetCount: deleted.rows.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function loadPreviewThread(ownerId: string, requestedConversationId?: string, locale: "en" | "zh-CN" = "en") {
  const pool = getPool();
  const conversation = await pool.query<{ id: string; createdAt: Date; lastActivityAt: Date }>(
    requestedConversationId
      ? "SELECT id,created_at AS \"createdAt\",last_activity_at AS \"lastActivityAt\" FROM conversations WHERE id=$1 AND owner_id=$2 AND mode='preview' LIMIT 1"
      : "SELECT id,created_at AS \"createdAt\",last_activity_at AS \"lastActivityAt\" FROM conversations WHERE owner_id=$1 AND mode='preview' ORDER BY last_activity_at DESC,id DESC LIMIT 1",
    requestedConversationId ? [requestedConversationId, ownerId] : [ownerId],
  );
  const thread = conversation.rows[0] ?? (!requestedConversationId ? await ensureLatestPreviewConversation(ownerId) : null);
  if (requestedConversationId && !thread) throw new AppError("CONVERSATION_NOT_FOUND", "The conversation was not found.", 404);
  if (!thread) throw new AppError("CONVERSATION_CREATE_FAILED", "The preview conversation could not be created.", 500);
  await recoverStaleAnswers(thread.id, ownerId, pool);
  const actorKey = `candidate:${ownerId}`;
  const messages = await pool.query<{ citations: RawPreviewCitation[] } & Record<string, unknown>>(
    `SELECT message.id,message.role,message.status,
            CASE WHEN message.source_invalidated_at IS NOT NULL
                   OR ${invalidPreviewRagCitation}
                   OR EXISTS (
                     SELECT 1 FROM message_citations document_citation
                     LEFT JOIN chunks document_chunk ON document_chunk.id=document_citation.chunk_id AND document_chunk.owner_id=document_citation.owner_id
                     LEFT JOIN materials document_material ON document_material.id=document_chunk.material_id AND document_material.owner_id=document_chunk.owner_id
                     WHERE document_citation.message_id=message.id AND (document_material.id IS NULL OR document_material.status<>'indexed' OR document_material.visibility='private')
                   )
                   OR EXISTS (
                     SELECT 1 FROM repository_message_citations source
                     LEFT JOIN repositories repository ON repository.id=source.repository_id AND repository.owner_id=source.owner_id
                     LEFT JOIN repository_revisions revision ON revision.id=source.revision_id AND revision.owner_id=source.owner_id
                     WHERE source.message_id=message.id AND (repository.id IS NULL OR repository.disabled_at IS NOT NULL OR repository.visibility='private' OR revision.id IS NULL)
                   )
                 THEN 'This answer is no longer available because its source permissions changed.' ELSE message.content END AS content,
            message.model,
            CASE WHEN message.source_invalidated_at IS NOT NULL
                   OR ${invalidPreviewRagCitation}
                   OR EXISTS (
                     SELECT 1 FROM message_citations document_citation
                     LEFT JOIN chunks document_chunk ON document_chunk.id=document_citation.chunk_id AND document_chunk.owner_id=document_citation.owner_id
                     LEFT JOIN materials document_material ON document_material.id=document_chunk.material_id AND document_material.owner_id=document_chunk.owner_id
                     WHERE document_citation.message_id=message.id AND (document_material.id IS NULL OR document_material.status<>'indexed' OR document_material.visibility='private')
                   )
                   OR EXISTS (
                     SELECT 1 FROM repository_message_citations source
                     LEFT JOIN repositories repository ON repository.id=source.repository_id AND repository.owner_id=source.owner_id
                     LEFT JOIN repository_revisions revision ON revision.id=source.revision_id AND revision.owner_id=source.owner_id
                     WHERE source.message_id=message.id AND (repository.id IS NULL OR repository.disabled_at IS NOT NULL OR repository.visibility='private' OR revision.id IS NULL)
                   )
                 THEN 'SOURCE_PERMISSION_CHANGED' ELSE message.error_code END AS "errorCode",
            message.reply_to_message_id AS "replyToMessageId",message.created_at AS "createdAt",
            (SELECT value FROM answer_feedback WHERE message_id=message.id AND actor_key=$3) AS feedback,
            (SELECT jsonb_build_object('id',run.id,'version',run.version,'state',run.state,'phase',run.phase)
             FROM analysis_runs run WHERE run.assistant_message_id=message.id AND run.owner_id=message.owner_id
             ORDER BY run.created_at DESC,run.id DESC LIMIT 1) AS "analysisRun",
            (SELECT jsonb_build_object(
               'id',trace.id,'policyVersion',trace.policy_version,'indexVersionId',trace.index_version_id,
               'planner',trace.planner,'routeCounts',trace.route_counts,'selectedEvidence',trace.selected_evidence,
               'coverage',trace.coverage,'roundCount',trace.round_count,'degradations',trace.degradations,
               'configuredEvidenceTokens',trace.configured_evidence_tokens,'effectiveEvidenceTokens',trace.effective_evidence_tokens,
               'actualEvidenceTokens',trace.actual_evidence_tokens,'latencyMs',trace.latency_ms,'createdAt',trace.created_at)
             FROM rag_query_traces trace WHERE trace.message_id=message.id AND trace.owner_id=message.owner_id LIMIT 1) AS "retrievalTrace",
            coalesce((
              SELECT jsonb_agg(item.payload ORDER BY item.rank) FROM (
                SELECT citation.rank,jsonb_build_object(
                  'kind','document','chunkId',citation.chunk_id,'rank',citation.rank,'excerpt',citation.excerpt,
                  'materialId',material.id,'contentChecksum',material.content_checksum,'materialTitle',material.title,'materialKind',material.kind,
                  'mimeType',material.mime_type,'externalUrl',material.external_url,'visibility',material.visibility
                ) AS payload
                FROM message_citations citation
                JOIN chunks chunk ON chunk.id=citation.chunk_id AND chunk.owner_id=citation.owner_id
                JOIN materials material ON material.id=chunk.material_id AND material.owner_id=chunk.owner_id
                WHERE citation.message_id=message.id AND material.status='indexed' AND material.visibility<>'private'
                UNION ALL
                SELECT source.rank,jsonb_build_object(
                  'kind','repository','messageId',source.message_id,'rank',source.rank,'repositoryId',repository.id,
                  'repositoryTitle',repository.display_name,'revisionId',revision.id,'commitSha',revision.commit_sha,
                  'path',source.path,'lineStart',source.line_start,'lineEnd',source.line_end,'visibility',repository.visibility
                ) AS payload
                FROM repository_message_citations source
                JOIN repositories repository ON repository.id=source.repository_id AND repository.owner_id=source.owner_id AND repository.disabled_at IS NULL
                JOIN repository_revisions revision ON revision.id=source.revision_id AND revision.owner_id=source.owner_id
                WHERE source.message_id=message.id AND repository.visibility<>'private'
                UNION ALL
                SELECT rag.rank,CASE WHEN rag.source_kind='material' THEN jsonb_build_object(
                  'kind','document','chunkId',rag.evidence_id,'rank',rag.rank,
                  'materialId',material.id,'contentChecksum',material.content_checksum,'materialTitle',material.title,'materialKind',material.kind,
                  'mimeType',material.mime_type,'externalUrl',material.external_url,'visibility',material.visibility
                ) ELSE jsonb_build_object(
                  'kind','repository','messageId',rag.message_id,'rank',rag.rank,'repositoryId',repository.id,
                  'repositoryTitle',repository.display_name,'revisionId',revision.id,'commitSha',revision.commit_sha,
                  'path',rag.metadata->>'path','lineStart',(rag.metadata#>>'{sourceRange,lineStart}')::integer,
                  'lineEnd',(rag.metadata#>>'{sourceRange,lineEnd}')::integer,'visibility',repository.visibility
                ) END AS payload
                FROM rag_message_citations rag
                JOIN rag_child_chunks child ON child.id=rag.evidence_id AND child.owner_id=rag.owner_id
                  AND child.index_version_id=rag.index_version_id AND child.source_version_id=rag.source_version_id AND child.content_checksum=rag.content_checksum
                JOIN rag_source_versions rag_source ON rag_source.id=rag.source_version_id AND rag_source.owner_id=rag.owner_id AND rag_source.state='active'
                JOIN rag_index_versions rag_version ON rag_version.id=rag.index_version_id AND rag_version.state='active'
                LEFT JOIN materials material ON rag.source_kind='material' AND material.id=rag.source_id AND material.owner_id=rag.owner_id
                LEFT JOIN repositories repository ON rag.source_kind<>'material' AND repository.id::text=coalesce(rag_source.metadata->>'repositoryId',rag.source_id::text) AND repository.owner_id=rag.owner_id
                LEFT JOIN repository_revisions revision ON revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id
                WHERE rag.message_id=message.id AND (
                  (rag.source_kind='material' AND material.status='indexed' AND material.visibility<>'private' AND material.content_checksum=rag_source.source_revision)
                  OR (rag.source_kind IN ('repository_markdown','repository_pdf') AND repository.disabled_at IS NULL AND repository.visibility<>'private'
                    AND revision.commit_sha=rag_source.metadata->>'commitSha')
                )
                UNION ALL
                SELECT rag.rank*100+source.ordinality, jsonb_build_object(
                  'kind','repository','messageId',rag.message_id,'rank',rag.rank*100+source.ordinality,'repositoryId',repository.id,
                  'repositoryTitle',repository.display_name,'revisionId',revision.id,'commitSha',revision.commit_sha,
                  'path',source.value->>'path','lineStart',(source.value->>'lineStart')::integer,
                  'lineEnd',(source.value->>'lineEnd')::integer,'visibility',repository.visibility
                ) AS payload
                FROM rag_message_citations rag
                JOIN rag_source_versions rag_source ON rag_source.id=rag.source_version_id AND rag_source.owner_id=rag.owner_id AND rag_source.state='active'
                JOIN rag_index_versions rag_version ON rag_version.id=rag.index_version_id AND rag_version.state='active'
                JOIN repositories repository ON repository.id::text=rag_source.metadata->>'repositoryId' AND repository.owner_id=rag.owner_id AND repository.disabled_at IS NULL
                JOIN repository_revisions revision ON revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id
                CROSS JOIN LATERAL jsonb_array_elements(rag.metadata->'sourceCitations') WITH ORDINALITY source(value,ordinality)
                WHERE rag.message_id=message.id AND rag.source_kind='approved_wiki' AND repository.visibility<>'private'
              ) item
              WHERE message.source_invalidated_at IS NULL
            ),'[]'::jsonb) AS citations
     FROM messages message
     WHERE message.conversation_id=$1 AND message.owner_id=$2
     ORDER BY message.created_at ASC,CASE WHEN message.role='user' THEN 0 ELSE 1 END,message.id ASC`,
    [thread.id, ownerId, actorKey],
  );
  const suggestedQuestions = await ensureConversationSuggestions({ conversationId: thread.id, ownerId, mode: "preview", locale });
  return { conversation: thread, messages: messages.rows.map((message) => ({ ...message, citations: projectPreviewCitations(message.citations) })), suggestedQuestions };
}

async function persistAnswer(
  ownerId: string,
  exchange: Extract<Awaited<ReturnType<typeof beginExchange>>, { created: true }>,
  result: PreviewAnswerResult,
  model: string,
  latencyMs: number,
  requestId?: string,
) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (result.outcome === "answered") await validateRagEvidence(client, ownerId, "candidate_preview", result.citations);
    const updated = await client.query(
      `UPDATE messages SET status='completed',content=$3,model=$4,latency_ms=$5,error_code=$6
       WHERE id=$1 AND owner_id=$2 AND status='pending'`,
      [exchange.assistantMessageId, ownerId, result.answer, result.outcome === "answered" ? model : null, latencyMs, result.outcome === "answered" ? null : result.outcome.toUpperCase()],
    );
    if (updated.rowCount !== 1) throw new AppError("ANSWER_ALREADY_SETTLED", "The answer request was already settled.", 409);
    await persistRagAnswerCitations(client, ownerId, exchange.assistantMessageId, result.citations);
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
      [ownerId, exchange.assistantMessageId, result.outcome, requestId ?? null, JSON.stringify({ conversationId: exchange.conversationId, citationCount: answerRagCitationCount(result.citations) })],
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

  const startedAt = performance.now();
  const currentDate = new Date().toISOString().slice(0, 10);
  let failureModel = "unconfigured";
  try {
    const config = getRuntimeConfig();
    failureModel = config.ai.profiles.router.model;
    const settingsResult = await getPool().query<{ answerTone: "professional" | "concise" | "conversational"; privacySafeMode: boolean }>(
      `SELECT answer_tone AS "answerTone",privacy_safe_mode AS "privacySafeMode" FROM agent_settings WHERE owner_id=$1`,
      [ownerId],
    );
    const settings = settingsResult.rows[0] ?? { answerTone: "professional" as const, privacySafeMode: true };
    const assessment = assessAgentQuestion(input.question);
    const retrievalStartedAt = performance.now();
    const retrieval = assessment.allowed
      ? await retrieveRagForQuestion({ pool: getPool(), config, ownerId, consumer: "candidate_preview", question: assessment.question, conversationId: exchange.conversationId, conversation: await priorConversationMessages(exchange.conversationId, exchange.userMessageId), currentDate })
      : null;
    const evidence = retrieval?.candidates ?? [];
    if (retrieval) {
      await persistRetrievalTrace(getPool(), {
        ownerId, conversationId: exchange.conversationId, messageId: exchange.assistantMessageId,
        callerMode: "candidate_preview", config, result: retrieval, latencyMs: performance.now() - retrievalStartedAt,
      });
    }
    let insufficientEvidenceRepositoryId: string | null = null;
    const entityGateRoute = retrieval ? hostEntityGateRoute(retrieval.entityResolution) : null;
    if (assessment.allowed && entityGateRoute) {
      await recordQuestionRoute(getPool(), {
        ownerId, actorRole: "candidate", conversationId: exchange.conversationId,
        ...entityGateRoute, evidenceCount: evidence.length, requestId,
      });
    } else if (assessment.allowed) {
      const resolvedRepositoryId = retrieval ? uniquelyResolvedRepositoryId(retrieval.entityResolution) : null;
      const repositories = await loadQuestionRepositories({ pool: getPool(), config, ownerId, mode: "candidate" });
      const routerStartedAt = performance.now();
      const decision = await routeQuestion({
        question: assessment.question,
        evidenceSummaries: evidence.map((item) => `${item.title}: ${item.parentContent}`),
        repositories,
      }, new OpenAiChatClient({ apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl, profile: config.ai.profiles.router }));
      await recordSuccessfulAiUsage({ pool: getPool(), ownerId, purpose: "agent.router", model: config.ai.profiles.router.model, ...decision.usage, latencyMs: Math.round(performance.now() - routerStartedAt) });
      const sourceInspectionRepository = selectSourceInspectionRepository(assessment.question, repositories, resolvedRepositoryId);
      const selected = sourceInspectionRepository ?? (decision.repositoryId === resolvedRepositoryId ? repositories.find((repository) => repository.id === decision.repositoryId) : null);
      insufficientEvidenceRepositoryId = selectInsufficientEvidenceRepository(decision, repositories, resolvedRepositoryId)?.id ?? null;
      const effectiveRoute = effectiveQuestionRoute(decision, selected ?? null, sourceInspectionRepository !== null);
      await recordQuestionRoute(getPool(), {
        ownerId, actorRole: "candidate", conversationId: exchange.conversationId,
        requestedRoute: decision.route, effectiveRoute,
        reasonCode: sourceInspectionRepository ? "source_inspection_required" : decision.route === "deep" && effectiveRoute !== "deep" ? "low_confidence_rag_fallback" : decision.route === "refuse" && effectiveRoute !== "refuse" ? "router_refuse_not_deterministic" : decision.reasonCode,
        confidence: decision.confidence, repositoryId: selected?.id ?? decision.repositoryId, evidenceCount: evidence.length, requestId,
      });
      if (effectiveRoute === "deep" && selected) {
        const run = await queueConversationAnalysisRun({
          pool: getPool(), config, ownerId, repositoryId: selected.id, conversationId: exchange.conversationId,
          assistantMessageId: exchange.assistantMessageId, clientMessageId: input.clientMessageId, actorRole: "candidate", requestId,
        });
        return { ...(await loadPreviewThread(ownerId, exchange.conversationId)), idempotent: false, pending: true, analysisRun: run };
      }
      if (effectiveRoute === "refuse") {
        const result: PreviewAnswerResult = {
          outcome: "refused" as const,
          answer: decision.reasonCode === "deep_analysis_not_allowed"
            ? localizedQuestionMessage(input.question, { en: "Deep Repository analysis is not available for that source. I can still answer from its approved evidence when available.", zh: "该来源当前不允许进行深度代码仓库分析；如果存在已批准证据，我仍可以据此回答。" })
            : localizedQuestionMessage(input.question, { en: "I cannot answer that request within the authorized career evidence boundary.", zh: "该请求超出了当前授权的职业证据范围，我无法回答。" }),
          refusalCode: decision.reasonCode === "deep_analysis_not_allowed" ? "DEEP_ANALYSIS_NOT_ALLOWED" : "QUESTION_OUT_OF_SCOPE",
          citations: [],
          usage: decision.usage,
        };
        await persistAnswer(ownerId, exchange, result, config.ai.profiles.router.model, Math.round(performance.now() - startedAt), requestId);
        return { ...(await loadPreviewThread(ownerId, exchange.conversationId)), idempotent: false, pending: false };
      }
    }
    failureModel = config.ai.profiles.rag.model;
    const result = await generateVerifiedRagAnswer({
      question: input.question,
      evidence,
      coverage: retrieval?.coverage ?? "none",
      unsupportedAspects: retrieval?.unsupportedAspects ?? [],
      missingEntities: retrieval ? [
        ...retrieval.entityResolution.missing.map((mention) => mention.text),
      ] : [],
      ambiguousEntities: retrieval?.entityResolution.ambiguous.map((item) => item.mention.text) ?? [],
      entityReferenceIssue: retrieval?.entityResolution.contextReference?.status,
      queryClarification: retrieval?.entityResolution.gateReason === "query_clarification_required",
      answerAspects: retrieval?.plan.answerAspects,
      currentDate,
      settings,
      generatorClient: new OpenAiChatClient({ apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl, profile: config.ai.profiles.rag }),
      verifierClient: new OpenAiChatClient({ apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl, profile: config.ai.profiles.verifier }),
      validateEvidence: (citations) => validateRagEvidence(getPool(), ownerId, "candidate_preview", citations),
    });
    if (result.outcome === "insufficient_evidence" && assessment.allowed) {
      const repositories = await loadQuestionRepositories({ pool: getPool(), config, ownerId, mode: "candidate" });
      const selected = insufficientEvidenceRepositoryId
        ? repositories.find((repository) => repository.id === insufficientEvidenceRepositoryId && repository.deepAllowed)
        : null;
      if (selected) {
        await recordQuestionRoute(getPool(), {
          ownerId, actorRole: "candidate", conversationId: exchange.conversationId,
          requestedRoute: "rag", effectiveRoute: "deep", reasonCode: "rag_insufficient_selected_repository",
          confidence: 1, repositoryId: selected.id, evidenceCount: evidence.length, requestId,
        });
        const run = await queueConversationAnalysisRun({
          pool: getPool(), config, ownerId, repositoryId: selected.id, conversationId: exchange.conversationId,
          assistantMessageId: exchange.assistantMessageId, clientMessageId: input.clientMessageId, actorRole: "candidate", requestId,
        });
        return { ...(await loadPreviewThread(ownerId, exchange.conversationId)), idempotent: false, pending: true, analysisRun: run };
      }
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    await persistAnswer(ownerId, exchange, result, config.ai.profiles.rag.model, latencyMs, requestId);
    return { ...(await loadPreviewThread(ownerId, exchange.conversationId)), idempotent: false, pending: false };
  } catch (error) {
    return persistAnswerFailure(ownerId, exchange, error, failureModel, Math.round(performance.now() - startedAt), requestId);
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
      `INSERT INTO rag_feedback(message_id,owner_id,actor_key,value) VALUES ($1,$2,$3,$4)
       ON CONFLICT (message_id,actor_key) DO UPDATE SET value=excluded.value,updated_at=now()`,
      [messageId, ownerId, actorKey, input.value],
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
