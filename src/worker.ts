import os from "node:os";

import { Pool } from "pg";

import { getRuntimeConfig, requireDatabaseUrl } from "./server/config";
import { toAppError } from "./server/errors";
import { failIngestionJob } from "./server/jobs/fail-ingestion";
import { claimNextIngestionJob } from "./server/jobs/ingestion-jobs";
import { processIngestionLease } from "./server/jobs/process-ingestion";
import { startWorkerHeartbeat } from "./server/jobs/worker-heartbeat";

const POLL_INTERVAL_MS = 1_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const workerId = `${os.hostname()}:${process.pid}`;
let stopping = false;

function wait(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function heartbeat(pool: Pool) {
  await pool.query(
    `INSERT INTO worker_heartbeats(worker_id,version,last_seen_at)
     VALUES ($1,$2,now())
     ON CONFLICT (worker_id) DO UPDATE SET version=excluded.version,last_seen_at=excluded.last_seen_at`,
    [workerId, process.env.npm_package_version ?? "0.1.0"],
  );
}

async function main() {
  const config = getRuntimeConfig();
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 5 });
  console.info(JSON.stringify({ event: "worker.started", workerId, model: config.deepseek.model }));
  const stopHeartbeat = await startWorkerHeartbeat(() => heartbeat(pool), {
    intervalMs: HEARTBEAT_INTERVAL_MS,
    onError: (error) => {
      const safeError = toAppError(error);
      console.error(JSON.stringify({ event: "worker.heartbeat.error", workerId, errorCode: safeError.code }));
    },
  });

  try {
    while (!stopping) {
      try {
        const lease = await claimNextIngestionJob(pool, workerId, 120_000);
        if (!lease) {
          await wait(POLL_INTERVAL_MS);
          continue;
        }
        try {
          const result = await processIngestionLease(pool, lease, config);
          console.info(
            JSON.stringify({
              event: "worker.material.indexed",
              workerId,
              jobId: lease.jobId,
              materialId: lease.material.id,
              attempt: lease.attempt,
              chunkCount: result.chunkCount,
              knowledgeItemCount: result.knowledgeItemIds.length,
            }),
          );
        } catch (error) {
          const safeError = toAppError(error);
          try {
            const decision = await failIngestionJob(pool, lease, safeError, config.deepseek.model);
            console.warn(
              JSON.stringify({ event: "worker.material.failed", workerId, jobId: lease.jobId, materialId: lease.material.id, attempt: lease.attempt, errorCode: decision.code, outcome: decision.outcome }),
            );
          } catch (reconcileError) {
            const reconcile = toAppError(reconcileError);
            console.error(JSON.stringify({ event: "worker.material.reconcile_failed", workerId, jobId: lease.jobId, materialId: lease.material.id, errorCode: reconcile.code }));
          }
        }
      } catch (error) {
        const safeError = toAppError(error);
        console.error(JSON.stringify({ event: "worker.loop.error", workerId, errorCode: safeError.code }));
        await wait(3_000);
      }
    }
  } finally {
    stopHeartbeat();
    await pool.end();
    console.info(JSON.stringify({ event: "worker.stopped", workerId }));
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

main().catch((error: unknown) => {
  const safeError = toAppError(error);
  console.error(JSON.stringify({ event: "worker.failed", workerId, errorCode: safeError.code }));
  process.exitCode = 1;
});
