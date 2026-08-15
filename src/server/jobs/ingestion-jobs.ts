import type { Pool } from "pg";

import { AppError } from "@/server/errors";
import type { StoredMaterial } from "@/server/materials/text-extraction";

export type IngestionLease = {
  jobId: string;
  material: StoredMaterial;
  attempt: number;
  maxAttempts: number;
  leaseOwner: string;
  leaseExpiresAt: Date;
};

type LeaseRow = {
  jobId: string;
  materialId: string;
  ownerId: string;
  title: string;
  attempts: number;
  maxAttempts: number;
  kind: StoredMaterial["kind"];
  originalName: string | null;
  storagePath: string | null;
};

export async function claimNextIngestionJob(pool: Pool, workerId: string, leaseDurationMs = 60_000, materialIds?: string[]): Promise<IngestionLease | null> {
  const normalizedWorkerId = workerId.trim().slice(0, 200);
  if (!normalizedWorkerId) throw new AppError("INVALID_WORKER_ID", "A worker identifier is required.", 500);
  if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 10 * 60_000) {
    throw new AppError("INVALID_LEASE_DURATION", "The ingestion lease duration is invalid.", 500);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<LeaseRow>(
      `SELECT j.id AS "jobId", j.material_id AS "materialId", j.owner_id AS "ownerId",
              j.attempts, j.max_attempts AS "maxAttempts", m.title, m.kind, m.original_name AS "originalName", m.storage_path AS "storagePath"
       FROM ingestion_jobs j
       JOIN materials m ON m.id = j.material_id AND m.owner_id = j.owner_id
       WHERE j.next_run_at <= now()
         AND j.attempts < j.max_attempts
         AND ($1::uuid[] IS NULL OR j.material_id=ANY($1::uuid[]))
         AND (j.status = 'queued' OR (j.status = 'processing' AND j.lease_expires_at <= now()))
       ORDER BY j.next_run_at ASC, j.created_at ASC, j.id ASC
       FOR UPDATE OF j SKIP LOCKED
       LIMIT 1`,
      [materialIds ?? null],
    );
    const row = selected.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }

    const lease = await client.query<{ leaseExpiresAt: Date; attempt: number }>(
      `UPDATE ingestion_jobs
       SET status='processing', attempts=attempts+1, lease_owner=$2,
           lease_expires_at=now() + ($3::integer * interval '1 millisecond'), updated_at=now()
       WHERE id=$1
       RETURNING lease_expires_at AS "leaseExpiresAt", attempts AS attempt`,
      [row.jobId, normalizedWorkerId, leaseDurationMs],
    );
    await client.query(
      `UPDATE materials
       SET status='processing', error_code=NULL, error_message=NULL, updated_at=now()
       WHERE id=$1 AND owner_id=$2`,
      [row.materialId, row.ownerId],
    );
    await client.query("COMMIT");
    const leased = lease.rows[0];
    if (!leased) throw new AppError("JOB_LEASE_FAILED", "The ingestion job could not be leased.", 500);
    return {
      jobId: row.jobId,
      material: { id: row.materialId, ownerId: row.ownerId, title: row.title, kind: row.kind, originalName: row.originalName, storagePath: row.storagePath },
      attempt: leased.attempt,
      maxAttempts: row.maxAttempts,
      leaseOwner: normalizedWorkerId,
      leaseExpiresAt: leased.leaseExpiresAt,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function renewIngestionLease(pool: Pool, lease: IngestionLease, leaseDurationMs = 120_000) {
  const renewed = await pool.query<{ leaseExpiresAt: Date }>(
    `UPDATE ingestion_jobs
     SET lease_expires_at=now() + ($4::integer * interval '1 millisecond'), updated_at=now()
     WHERE id=$1 AND material_id=$2 AND status='processing' AND lease_owner=$3 AND lease_expires_at > now()
     RETURNING lease_expires_at AS "leaseExpiresAt"`,
    [lease.jobId, lease.material.id, lease.leaseOwner, leaseDurationMs],
  );
  const result = renewed.rows[0];
  if (!result) throw new AppError("JOB_LEASE_LOST", "The ingestion job lease is no longer owned by this worker.", 409);
  lease.leaseExpiresAt = result.leaseExpiresAt;
  return result.leaseExpiresAt;
}
