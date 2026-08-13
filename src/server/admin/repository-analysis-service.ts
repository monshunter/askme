import { queueRepositoryAnalysisRun } from "@/server/code-agent/analysis-runs";
import { requestAnalysisRunCancellation, requestRepositoryAnalysisCancellationInTransaction } from "@/server/code-agent/analysis-cancellation";
import { getRuntimeConfig } from "@/server/config";
import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";

import type { AnalysisRunActionInput, RepositoryActionInput } from "./admin-input";

export async function listAdminRepositories(query: { search: string; page: number; pageSize: number }) {
  const offset = (query.page - 1) * query.pageSize;
  const pattern = `%${query.search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const [itemsResult, countResult] = await Promise.all([
    getPool().query<{
      id: string; displayName: string; canonicalUrl: string; visibility: string; disabledAt: Date | null; updatedAt: Date;
      candidateId: string; candidateName: string; activeCommitSha: string | null; runId: string | null; runPurpose: string | null;
      runState: string | null; runPhase: string | null; safeErrorCode: string | null; runUpdatedAt: Date | null; toolCalls: number;
    }>(
      `SELECT repository.id,repository.display_name AS "displayName",repository.canonical_url AS "canonicalUrl",
              repository.visibility,repository.disabled_at AS "disabledAt",repository.updated_at AS "updatedAt",
              candidate.id AS "candidateId",candidate.display_name AS "candidateName",revision.commit_sha AS "activeCommitSha",
              latest.id AS "runId",latest.purpose AS "runPurpose",latest.state AS "runState",latest.phase AS "runPhase",
              latest.safe_error_code AS "safeErrorCode",latest.updated_at AS "runUpdatedAt",
              coalesce((latest.usage->>'toolCalls')::int,0) AS "toolCalls"
       FROM repositories repository
       JOIN users candidate ON candidate.id=repository.owner_id
       LEFT JOIN repository_revisions revision ON revision.id=repository.active_revision_id
       LEFT JOIN LATERAL (
         SELECT id,purpose,state,phase,safe_error_code,usage,updated_at FROM analysis_runs
         WHERE repository_id=repository.id ORDER BY created_at DESC,id DESC LIMIT 1
       ) latest ON true
       WHERE ($1='' OR repository.display_name ILIKE $2 ESCAPE '\\' OR candidate.display_name ILIKE $2 ESCAPE '\\')
       ORDER BY repository.updated_at DESC,repository.id DESC LIMIT $3 OFFSET $4`,
      [query.search, pattern, query.pageSize, offset],
    ),
    getPool().query<{ total: number }>(
      `SELECT count(*)::int AS total FROM repositories repository JOIN users candidate ON candidate.id=repository.owner_id
       WHERE ($1='' OR repository.display_name ILIKE $2 ESCAPE '\\' OR candidate.display_name ILIKE $2 ESCAPE '\\')`,
      [query.search, pattern],
    ),
  ]);
  const total = countResult.rows[0]?.total ?? 0;
  return { items: itemsResult.rows, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
}

export async function governAdminRepository(adminId: string, repositoryId: string, input: RepositoryActionInput, requestId?: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ ownerId: string; disabledAt: Date | null }>(
      `SELECT owner_id AS "ownerId",disabled_at AS "disabledAt" FROM repositories WHERE id=$1 FOR UPDATE`, [repositoryId],
    );
    const repository = result.rows[0];
    if (!repository) throw new AppError("REPOSITORY_NOT_FOUND", "The Repository was not found.", 404);
    const disable = input.action === "disable";
    const changed = disable ? repository.disabledAt === null : repository.disabledAt !== null;
    if (changed) {
      await client.query("UPDATE repositories SET disabled_at=$2,updated_at=now() WHERE id=$1", [repositoryId, disable ? new Date() : null]);
      if (disable) await requestRepositoryAnalysisCancellationInTransaction(client, repository.ownerId, repositoryId, "repository_disabled");
    }
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'admin',$2,'repository',$3,$4,$5,$6::jsonb)`,
      [adminId, `admin.repository.${input.action}`, repositoryId, changed ? input.action : "unchanged", requestId ?? null, JSON.stringify({ reason: input.reason })],
    );
    await client.query("COMMIT");
    return { id: repositoryId, disabled: disable, changed };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelAdminAnalysisRun(adminId: string, runId: string, input: AnalysisRunActionInput, requestId?: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ state: string }>("SELECT state FROM analysis_runs WHERE id=$1 FOR UPDATE", [runId]);
    if (!existing.rows[0]) throw new AppError("ANALYSIS_RUN_NOT_FOUND", "The analysis run was not found.", 404);
    const changed = existing.rows[0].state === "pending" || existing.rows[0].state === "running";
    if (changed) await requestAnalysisRunCancellation(client, runId, "admin_cancelled");
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'admin','admin.analysis.cancel','analysis_run',$2,$3,$4,$5::jsonb)`,
      [adminId, runId, changed ? "cancel_requested" : "unchanged", requestId ?? null, JSON.stringify({ reason: input.reason })],
    );
    await client.query("COMMIT");
    return { id: runId, cancelRequested: changed, state: existing.rows[0].state };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function rerunAdminRepositoryAnalysis(adminId: string, repositoryId: string, requestId?: string) {
  const repository = await getPool().query<{ ownerId: string }>(
    "SELECT owner_id AS \"ownerId\" FROM repositories WHERE id=$1 AND disabled_at IS NULL",
    [repositoryId],
  );
  const ownerId = repository.rows[0]?.ownerId;
  if (!ownerId) throw new AppError("REPOSITORY_NOT_FOUND", "The Repository was not found.", 404);
  return queueRepositoryAnalysisRun({
    pool: getPool(),
    config: getRuntimeConfig(),
    ownerId,
    actorId: adminId,
    repositoryId,
    explicitRerun: true,
    actorRole: "admin",
    requestId,
  });
}
