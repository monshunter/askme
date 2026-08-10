import type { Pool } from "pg";

import { AppError } from "@/server/errors";

import { ingestionFailureDecision } from "./failure-policy";
import type { IngestionLease } from "./ingestion-jobs";

export async function failIngestionJob(pool: Pool, lease: IngestionLease, error: unknown, model: string) {
  const decision = ingestionFailureDecision(error, lease.attempt, lease.maxAttempts);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query(
      `SELECT id FROM ingestion_jobs
       WHERE id=$1 AND material_id=$2 AND owner_id=$3 AND status='processing' AND lease_owner=$4
       FOR UPDATE`,
      [lease.jobId, lease.material.id, lease.material.ownerId, lease.leaseOwner],
    );
    if (!owned.rows[0]) throw new AppError("JOB_LEASE_LOST", "The ingestion job lease is no longer owned by this worker.", 409);

    if (decision.outcome === "failed") {
      await client.query(
        `UPDATE ingestion_jobs
         SET status='failed',lease_owner=NULL,lease_expires_at=NULL,last_error_code=$2,last_error_message=$3,updated_at=now()
         WHERE id=$1`,
        [lease.jobId, decision.code, decision.message],
      );
      await client.query(
        `UPDATE materials SET status='failed',error_code=$3,error_message=$4,updated_at=now()
         WHERE id=$1 AND owner_id=$2`,
        [lease.material.id, lease.material.ownerId, decision.code, decision.message],
      );
    } else {
      await client.query(
        `UPDATE ingestion_jobs
         SET status='queued',lease_owner=NULL,lease_expires_at=NULL,
             next_run_at=now() + ($2::integer * interval '1 second'),last_error_code=$3,last_error_message=$4,updated_at=now()
         WHERE id=$1`,
        [lease.jobId, decision.backoffSeconds, decision.code, decision.message],
      );
      await client.query(
        `UPDATE materials SET status='queued',error_code=$3,error_message=$4,updated_at=now()
         WHERE id=$1 AND owner_id=$2`,
        [lease.material.id, lease.material.ownerId, decision.code, decision.message],
      );
    }

    if (decision.code.startsWith("AI_")) {
      await client.query(
        `INSERT INTO ai_usage(owner_id,purpose,model,outcome,error_code)
         VALUES ($1,'material.organize',$2,'failed',$3)`,
        [lease.material.ownerId, model, decision.code],
      );
    }
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,metadata)
       VALUES ($1,'system','material.process','material',$2,$3,$4::jsonb)`,
      [
        lease.material.ownerId,
        lease.material.id,
        decision.outcome,
        JSON.stringify({ jobId: lease.jobId, errorCode: decision.code, attempt: lease.attempt, backoffSeconds: decision.backoffSeconds }),
      ],
    );
    await client.query("COMMIT");
    return decision;
  } catch (failure) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw failure;
  } finally {
    client.release();
  }
}
