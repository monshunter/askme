import { z } from "zod";

import type { Pool } from "pg";

import type { CodeAgentBudget } from "@/server/config";
import { AppError } from "@/server/errors";
import type { RepositoryArtifactDescriptor } from "@/server/repositories/artifact-reader";

const budgetSchema = z.object({
  analysisTimeoutMs: z.number().int().min(1_000).max(3_600_000),
  maxRounds: z.number().int().min(1).max(100),
  maxToolCalls: z.number().int().min(1).max(1_000),
  maxAggregateToolOutputBytes: z.number().int().min(1_024).max(16 * 1024 * 1024),
  maxReadBytes: z.number().int().min(1_024).max(1024 * 1024),
  maxReadLines: z.number().int().min(1).max(10_000),
  maxSearchHits: z.number().int().min(1).max(10_000),
}).strict();

export type AnalysisRunLease = RepositoryArtifactDescriptor & {
  runId: string;
  ownerId: string;
  purpose: "repository_analysis" | "conversation_analysis";
  repositoryId: string;
  revisionId: string;
  analysisGeneration: number;
  leaseOwner: string;
  leaseExpiresAt: Date;
  staleMicrovmId: string | null;
  cancelRequested: boolean;
  budget: CodeAgentBudget;
  imageDigest: string;
  skillHash: string;
  promptVersion: string;
  profileFingerprint: string;
  configuredModel: string;
  repositoryDisplayName: string;
  repositoryVisibility: "private" | "agent_only" | "citation_allowed" | "public_preview";
  conversationId: string | null;
  assistantMessageId: string | null;
  userQuestion: string | null;
};

type LeaseRow = Omit<AnalysisRunLease, "budget" | "leaseOwner" | "staleMicrovmId"> & {
  budgetSnapshot: unknown;
  leaseExpiresAt: Date;
};

export async function claimNextAnalysisRun(pool: Pool, input: {
  leaseOwner: string;
  leaseMs: number;
  globalConcurrency: number;
}): Promise<AnalysisRunLease | null> {
  if (!input.leaseOwner || input.leaseOwner.length > 200) throw new AppError("ANALYSIS_LEASE_OWNER_INVALID", "The Analysis Runner identity is invalid.", 500);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('askme-analysis-scheduler',0))");
    await client.query(
      `WITH cancelled AS (
         UPDATE analysis_runs SET state='cancelled',phase='cancelled',safe_error_code='CODE_AGENT_CANCELLED',version=version+1,
           finished_at=now(),cleanup_completed_at=now(),lease_owner=NULL,lease_expires_at=NULL,microvm_id=NULL,updated_at=now()
         WHERE state='pending' AND cancel_requested_at IS NOT NULL
         RETURNING id,version,assistant_message_id
       ),
       settled AS (
         UPDATE messages SET status='failed',content='Deep Repository analysis was cancelled. Retry when the source is available.',error_code='DEEP_ANALYSIS_CANCELLED'
         WHERE id IN (SELECT assistant_message_id FROM cancelled WHERE assistant_message_id IS NOT NULL) AND status='pending'
       )
       INSERT INTO analysis_run_events(run_id,version,state,phase)
       SELECT id,version,'cancelled','cancelled' FROM cancelled`,
    );
    const capacity = await client.query<{ running: number; repositoryRunning: number }>(
      `SELECT count(*) FILTER (WHERE state='running' AND lease_expires_at>now())::int AS running,
              count(*) FILTER (WHERE state='running' AND lease_expires_at>now() AND purpose='repository_analysis')::int AS "repositoryRunning"
       FROM analysis_runs`,
    );
    const counts = capacity.rows[0] ?? { running: 0, repositoryRunning: 0 };
    if (counts.running >= input.globalConcurrency) {
      await client.query("COMMIT");
      return null;
    }
    const repositorySlotAvailable = counts.repositoryRunning < input.globalConcurrency - 1;
    const candidate = await client.query<{ id: string; staleMicrovmId: string | null }>(
      `SELECT id,microvm_id AS "staleMicrovmId" FROM analysis_runs
       WHERE (state='pending' OR (state='running' AND lease_expires_at<=now()))
         AND (cancel_requested_at IS NULL OR state='running')
         AND (purpose='conversation_analysis' OR $1::boolean)
       ORDER BY (purpose='conversation_analysis') DESC,priority DESC,created_at,id
       FOR UPDATE SKIP LOCKED LIMIT 1`,
      [repositorySlotAvailable],
    );
    const selected = candidate.rows[0];
    if (!selected) {
      await client.query("COMMIT");
      return null;
    }
    const claimed = await client.query<{ version: number; phase: string }>(
      `UPDATE analysis_runs SET state='running',phase=CASE WHEN cancel_requested_at IS NULL THEN 'creating_sandbox' ELSE 'cancelling' END,lease_owner=$2,
         lease_expires_at=now()+($3::integer*interval '1 millisecond'),version=version+1,
         started_at=COALESCE(started_at,now()),microvm_id=NULL,safe_error_code=NULL,updated_at=now()
       WHERE id=$1 RETURNING version,phase`,
      [selected.id, input.leaseOwner, input.leaseMs],
    );
    const version = claimed.rows[0]?.version;
    if (!version) throw new AppError("ANALYSIS_LEASE_FAILED", "The Analysis Run could not be leased.", 500);
    await client.query("INSERT INTO analysis_run_events(run_id,version,state,phase) VALUES ($1,$2,'running',$3)", [selected.id, version, claimed.rows[0]!.phase]);
    const context = await client.query<LeaseRow>(
      `SELECT run.id AS "runId",run.owner_id AS "ownerId",run.purpose,run.repository_id AS "repositoryId",run.revision_id AS "revisionId",
              run.analysis_generation AS "analysisGeneration",run.lease_expires_at AS "leaseExpiresAt",run.budget_snapshot AS "budgetSnapshot",
              run.cancel_requested_at IS NOT NULL AS "cancelRequested",
              run.image_digest AS "imageDigest",run.skill_hash AS "skillHash",run.prompt_version AS "promptVersion",
              run.profile_fingerprint AS "profileFingerprint",run.configured_model AS "configuredModel",
              run.conversation_id AS "conversationId",run.assistant_message_id AS "assistantMessageId",
              question.content AS "userQuestion",
              repository.display_name AS "repositoryDisplayName",repository.visibility AS "repositoryVisibility",repository.canonical_url AS "canonicalUrl",
              revision.commit_sha AS "commitSha",revision.filter_fingerprint AS "filterFingerprint",
              artifact.content_key AS "contentKey",artifact.checksum,artifact.manifest_checksum AS "manifestChecksum",
              artifact.storage_path AS "storagePath",artifact.file_count AS "fileCount"
       FROM analysis_runs run
       JOIN repositories repository ON repository.id=run.repository_id AND repository.owner_id=run.owner_id
       JOIN repository_revisions revision ON revision.id=run.revision_id AND revision.owner_id=run.owner_id
       JOIN repository_artifacts artifact ON artifact.content_key=revision.artifact_key
       LEFT JOIN messages assistant ON assistant.id=run.assistant_message_id AND assistant.owner_id=run.owner_id
       LEFT JOIN messages question ON question.id=assistant.reply_to_message_id AND question.owner_id=run.owner_id
       WHERE run.id=$1`,
      [selected.id],
    );
    const row = context.rows[0];
    const parsedBudget = budgetSchema.safeParse(row?.budgetSnapshot);
    if (!row || !parsedBudget.success) throw new AppError("ANALYSIS_RUN_CONTEXT_INVALID", "The Analysis Run context is invalid.", 500);
    await client.query("COMMIT");
    return { ...row, budget: parsedBudget.data, leaseOwner: input.leaseOwner, staleMicrovmId: selected.staleMicrovmId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordAnalysisMicrovm(pool: Pool, lease: AnalysisRunLease, microvmId: string) {
  const result = await pool.query(
    `UPDATE analysis_runs SET microvm_id=$3,phase='analyzing',version=version+1,updated_at=now()
     WHERE id=$1 AND lease_owner=$2 AND state='running' AND lease_expires_at>now() AND cancel_requested_at IS NULL
     RETURNING version`,
    [lease.runId, lease.leaseOwner, microvmId],
  );
  if (!result.rows[0]) throw new AppError("ANALYSIS_LEASE_LOST", "The Analysis Run lease is no longer owned by this Runner.", 409);
  await pool.query("INSERT INTO analysis_run_events(run_id,version,state,phase) VALUES ($1,$2,'running','analyzing')", [lease.runId, result.rows[0].version]);
}

export async function renewAnalysisLease(pool: Pool, lease: AnalysisRunLease, leaseMs: number) {
  const result = await pool.query<{ leaseExpiresAt: Date; cancelRequestedAt: Date | null }>(
    `UPDATE analysis_runs SET lease_expires_at=now()+($3::integer*interval '1 millisecond'),updated_at=now()
     WHERE id=$1 AND lease_owner=$2 AND state='running' AND lease_expires_at>now()
     RETURNING lease_expires_at AS "leaseExpiresAt",cancel_requested_at AS "cancelRequestedAt"`,
    [lease.runId, lease.leaseOwner, leaseMs],
  );
  const renewed = result.rows[0];
  if (!renewed) throw new AppError("ANALYSIS_LEASE_LOST", "The Analysis Run lease is no longer owned by this Runner.", 409);
  lease.leaseExpiresAt = renewed.leaseExpiresAt;
  return { cancelRequested: renewed.cancelRequestedAt !== null };
}

export async function failAnalysisRun(pool: Pool, lease: AnalysisRunLease, input: {
  errorCode: string;
  cancelled: boolean;
  cleanupCompletedAt: Date | null;
}) {
  const state = input.cancelled ? "cancelled" : "failed";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ version: number }>(
      `UPDATE analysis_runs SET state=$3::analysis_run_state,phase=$3::text,safe_error_code=$4,version=version+1,
         lease_owner=NULL,lease_expires_at=NULL,microvm_id=NULL,finished_at=now(),cleanup_completed_at=$5,updated_at=now()
       WHERE id=$1 AND lease_owner=$2 AND state='running'
       RETURNING version`,
      [lease.runId, lease.leaseOwner, state, input.errorCode, input.cleanupCompletedAt],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new AppError("ANALYSIS_LEASE_LOST", "The failed Analysis Run lease is no longer owned by this Runner.", 409);
    if (lease.purpose === "conversation_analysis" && lease.assistantMessageId) {
      await client.query(
        `UPDATE messages SET status='failed',content=$3,error_code=$4
         WHERE id=$1 AND owner_id=$2 AND status='pending'`,
        [lease.assistantMessageId, lease.ownerId, input.cancelled ? "Deep Repository analysis was cancelled. Retry when the source is available." : "Deep Repository analysis failed. Retry the question.", input.cancelled ? "DEEP_ANALYSIS_CANCELLED" : input.errorCode],
      );
    }
    await client.query("INSERT INTO analysis_run_events(run_id,version,state,phase,safe_error_code) VALUES ($1,$2,$3::analysis_run_state,$3::text,$4)", [lease.runId, version, state, input.errorCode]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
