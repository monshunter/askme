import os from "node:os";
import { access, mkdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

import { Pool } from "pg";

import { claimNextAnalysisRun } from "./server/code-agent/analysis-leases";
import { processAnalysisLease } from "./server/code-agent/analysis-runner";
import { BoxliteCodeAgentSandbox } from "./server/code-agent/sandbox/boxlite-sandbox";
import { getRuntimeConfig, requireDatabaseUrl } from "./server/config";
import { toAppError } from "./server/errors";
import { startWorkerHeartbeat } from "./server/jobs/worker-heartbeat";

const runnerId = `${os.hostname()}:${process.pid}:agent-runner`;
const active = new Set<Promise<void>>();
let stopping = false;

function wait(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function heartbeat(pool: Pool, config: ReturnType<typeof getRuntimeConfig>) {
  let artifactReady = false;
  let boxliteReady = false;
  let safeErrorCode: string | null = null;
  try {
    await mkdir(config.repositoryArtifactRoot, { recursive: true });
    await access(config.repositoryArtifactRoot, fsConstants.R_OK | fsConstants.W_OK);
    artifactReady = true;
    if (config.codeAgent.rootfsPath) await access(config.codeAgent.rootfsPath, fsConstants.R_OK);
    boxliteReady = Boolean(config.codeAgent.rootfsPath || config.codeAgent.imageDigest);
  } catch (error) {
    safeErrorCode = toAppError(error).code;
  }
  await pool.query(
    `INSERT INTO analysis_runner_heartbeats(runner_id,version,image_digest,artifact_ready,boxlite_ready,safe_error_code,last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (runner_id) DO UPDATE SET version=excluded.version,image_digest=excluded.image_digest,
       artifact_ready=excluded.artifact_ready,boxlite_ready=excluded.boxlite_ready,safe_error_code=excluded.safe_error_code,last_seen_at=excluded.last_seen_at`,
    [runnerId, process.env.npm_package_version ?? "0.1.0", config.codeAgent.imageDigest, artifactReady, boxliteReady, safeErrorCode],
  );
}

async function main() {
  const config = getRuntimeConfig();
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: config.codeAgent.globalConcurrency + 3 });
  const sandbox = new BoxliteCodeAgentSandbox(config.codeAgent);
  pool.on("error", (error) => {
    console.error(JSON.stringify({ event: "agent-runner.pool.error", runnerId, errorCode: toAppError(error).code }));
  });
  console.info(JSON.stringify({ event: "agent-runner.started", runnerId, imageDigest: config.codeAgent.imageDigest, globalConcurrency: config.codeAgent.globalConcurrency }));
  const stopHeartbeat = await startWorkerHeartbeat(() => heartbeat(pool, config), {
    intervalMs: 10_000,
    onError: (error) => console.error(JSON.stringify({ event: "agent-runner.heartbeat.error", runnerId, errorCode: toAppError(error).code })),
  });
  try {
    while (!stopping) {
      let claimed = false;
      while (!stopping && active.size < config.codeAgent.globalConcurrency) {
        const lease = await claimNextAnalysisRun(pool, {
          leaseOwner: runnerId,
          leaseMs: config.codeAgent.leaseMs,
          globalConcurrency: config.codeAgent.globalConcurrency,
        });
        if (!lease) break;
        claimed = true;
        const task = processAnalysisLease({ pool, config, sandbox, lease })
          .then((result) => {
            console.info(JSON.stringify({ event: "agent-runner.run.completed", runnerId, ...result }));
          })
          .catch((error) => {
            console.warn(JSON.stringify({ event: "agent-runner.run.failed", runnerId, runId: lease.runId, errorCode: toAppError(error).code }));
          })
          .finally(() => {
            active.delete(task);
          });
        active.add(task);
      }
      if (active.size > 0) await Promise.race([Promise.race(active), wait(config.codeAgent.pollMs)]);
      else if (!claimed) await wait(config.codeAgent.pollMs);
    }
    await Promise.allSettled(active);
  } finally {
    stopHeartbeat();
    await sandbox.close().catch((error) => {
      console.error(JSON.stringify({ event: "agent-runner.shutdown.cleanup_failed", runnerId, errorCode: toAppError(error).code }));
    });
    await pool.end();
    console.info(JSON.stringify({ event: "agent-runner.stopped", runnerId }));
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "agent-runner.failed", runnerId, errorCode: toAppError(error).code }));
  process.exitCode = 1;
});
