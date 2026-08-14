import type { Pool } from "pg";

import { AppError } from "@/server/errors";
import { readRepositoryArtifactEvidence, type RepositoryArtifactDescriptor } from "@/server/repositories/artifact-reader";

import { codeAnswerResultSchema } from "./contracts";
import { validateCodeAnswerOutput } from "./conversation-output";

export async function validateConversationAnalysisEnvelope(input: {
  artifactRoot: string;
  artifact: RepositoryArtifactDescriptor;
  result: unknown;
  question?: string;
}) {
  const parsed = codeAnswerResultSchema.safeParse(input.result);
  if (!parsed.success) throw new AppError("CODE_ANSWER_OUTPUT_INVALID", "The deep analysis answer does not match its required schema.", 422);
  const paths = [...new Set(parsed.data.citations.map((citation) => citation.path))];
  const evidence = await readRepositoryArtifactEvidence(input.artifactRoot, input.artifact, paths);
  return validateCodeAnswerOutput(parsed.data, evidence, input.question);
}

export async function completeConversationAnalysisRun(input: {
  pool: Pool;
  artifactRoot: string;
  artifact: RepositoryArtifactDescriptor;
  runId: string;
  leaseOwner: string;
  output: unknown;
  actualModel: string;
  usage: Record<string, number>;
  cleanupCompletedAt: Date;
  question: string;
}) {
  const answer = await validateConversationAnalysisEnvelope({ artifactRoot: input.artifactRoot, artifact: input.artifact, result: input.output, question: input.question });
  const client = await input.pool.connect();
  try {
    await client.query("BEGIN");
    const context = await client.query<{
      ownerId: string;
      repositoryId: string;
      revisionId: string;
      conversationId: string;
      assistantMessageId: string;
      mode: "preview" | "public";
    }>(
      `SELECT run.owner_id AS "ownerId",run.repository_id AS "repositoryId",run.revision_id AS "revisionId",
              run.conversation_id AS "conversationId",run.assistant_message_id AS "assistantMessageId",conversation.mode
       FROM analysis_runs run
       JOIN users owner ON owner.id=run.owner_id AND owner.status='active'
       JOIN repositories repository ON repository.id=run.repository_id AND repository.owner_id=run.owner_id AND repository.disabled_at IS NULL
       JOIN repository_revisions revision ON revision.id=run.revision_id AND revision.owner_id=run.owner_id AND revision.state='stored'
       JOIN conversations conversation ON conversation.id=run.conversation_id AND conversation.owner_id=run.owner_id
       JOIN messages assistant ON assistant.id=run.assistant_message_id AND assistant.owner_id=run.owner_id AND assistant.conversation_id=conversation.id AND assistant.status='pending'
       LEFT JOIN publications publication ON publication.id=conversation.publication_id AND publication.owner_id=conversation.owner_id
       LEFT JOIN agent_settings settings ON settings.owner_id=conversation.owner_id
       WHERE run.id=$1 AND run.lease_owner=$2 AND run.purpose='conversation_analysis' AND run.state='running'
         AND run.cancel_requested_at IS NULL AND run.lease_expires_at>now()
         AND (
           (conversation.mode='preview' AND repository.visibility IN ('agent_only','citation_allowed','public_preview')) OR
           (conversation.mode='public' AND conversation.expires_at>now() AND publication.status='published' AND settings.public_mode=true
             AND repository.visibility IN ('citation_allowed','public_preview') AND repository.public_deep_analysis_enabled=true)
         )
       FOR UPDATE OF run,assistant`,
      [input.runId, input.leaseOwner],
    );
    const row = context.rows[0];
    if (!row) throw new AppError("CODE_AGENT_CANCELLED", "The deep analysis authorization changed before completion.", 409);
    const errorCode = answer.outcome === "answered" ? null : answer.outcome === "insufficient" ? "DEEP_ANALYSIS_INSUFFICIENT" : "DEEP_ANALYSIS_REFUSED";
    const updatedMessage = await client.query(
      `UPDATE messages SET status='completed',content=$3,model=$4,error_code=$5
       WHERE id=$1 AND owner_id=$2 AND status='pending'`,
      [row.assistantMessageId, row.ownerId, answer.answerMarkdown, answer.outcome === "answered" ? input.actualModel : null, errorCode],
    );
    if (updatedMessage.rowCount !== 1) throw new AppError("ANSWER_ALREADY_SETTLED", "The deep answer request was already settled.", 409);
    for (const [index, citation] of answer.citations.entries()) {
      await client.query(
        `INSERT INTO repository_message_citations(message_id,owner_id,repository_id,revision_id,rank,path,line_start,line_end,content_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.assistantMessageId, row.ownerId, row.repositoryId, row.revisionId, index + 1, citation.path, citation.lineStart, citation.lineEnd, citation.contentHash],
      );
    }
    const completed = await client.query<{ version: number }>(
      `UPDATE analysis_runs SET state='completed',outcome=$3::analysis_outcome,phase='completed',version=version+1,
         actual_model=$4,usage=$5::jsonb,lease_owner=NULL,lease_expires_at=NULL,microvm_id=NULL,
         finished_at=now(),cleanup_completed_at=$6,updated_at=now()
       WHERE id=$1 AND lease_owner=$2 AND state='running' RETURNING version`,
      [input.runId, input.leaseOwner, answer.outcome, input.actualModel, JSON.stringify(input.usage), input.cleanupCompletedAt],
    );
    const version = completed.rows[0]?.version;
    if (!version) throw new AppError("ANALYSIS_LEASE_LOST", "The completed Analysis Run lease is no longer owned by this Runner.", 409);
    await client.query("INSERT INTO analysis_run_events(run_id,version,state,phase) VALUES ($1,$2,'completed','completed')", [input.runId, version]);
    await client.query("UPDATE conversations SET last_activity_at=now() WHERE id=$1 AND owner_id=$2", [row.conversationId, row.ownerId]);
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,metadata)
       VALUES ($1,$2,'conversation.analysis.complete','analysis_run',$3,$4,$5::jsonb)`,
      [row.mode === "preview" ? row.ownerId : null, row.mode === "preview" ? "candidate" : "interviewer", input.runId, answer.outcome, JSON.stringify({ repositoryId: row.repositoryId, revisionId: row.revisionId, conversationId: row.conversationId, citationCount: answer.citations.length })],
    );
    await client.query("COMMIT");
    return { outcome: answer.outcome, messageId: row.assistantMessageId, version };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
