import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

import { getRuntimeConfig } from "@/server/config";
import { getPool } from "@/server/db/client";
import { apiData, requestId } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = requestId(request);
  const config = getRuntimeConfig();
  const checks = {
    database: "unavailable",
    migration: "missing",
    worker: "stale",
    runner: "missing",
    artifact: "unavailable",
    boxlite: "unavailable",
    provenance: config.codeAgent.imageDigest ? "unverified" : "unconfigured",
    ai: config.ai.apiKey ? "configured" : "not_configured",
  };

  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    checks.database = "ready";
    const migration = await pool.query<{ currentApplied: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version='0016_analysis_runner_health.sql') AS \"currentApplied\"",
    );
    checks.migration = migration.rows[0]?.currentApplied ? "ready" : "missing";
    const heartbeat = await pool.query<{ healthy: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM worker_heartbeats WHERE last_seen_at > now() - interval '30 seconds') AS healthy",
    );
    checks.worker = heartbeat.rows[0]?.healthy ? "ready" : "stale";
    const runner = await pool.query<{ fresh: boolean; artifactReady: boolean; boxliteReady: boolean; imageDigest: string | null }>(
      `SELECT last_seen_at>now()-interval '30 seconds' AS fresh,artifact_ready AS "artifactReady",boxlite_ready AS "boxliteReady",image_digest AS "imageDigest"
       FROM analysis_runner_heartbeats ORDER BY last_seen_at DESC LIMIT 1`,
    );
    const runnerState = runner.rows[0];
    checks.runner = runnerState?.fresh ? "ready" : runnerState ? "stale" : "missing";
    checks.boxlite = runnerState?.fresh && runnerState.boxliteReady ? "ready" : "unavailable";
    if (config.codeAgent.imageDigest && runnerState?.fresh) {
      checks.provenance = runnerState.imageDigest === config.codeAgent.imageDigest ? "ready" : "mismatch";
    }
    try {
      await access(config.repositoryArtifactRoot, fsConstants.R_OK | fsConstants.W_OK);
      checks.artifact = runnerState?.fresh && runnerState.artifactReady ? "ready" : "degraded";
    } catch {
      checks.artifact = "unavailable";
    }
  } catch {
    // The structured check values are intentionally safe and contain no connection details.
  }

  const ready = checks.database === "ready" && checks.migration === "ready" && checks.worker === "ready";
  const codeAgentReady = checks.runner === "ready" && checks.artifact === "ready" && checks.boxlite === "ready" && checks.provenance === "ready" && checks.ai === "configured";
  return apiData({ status: ready ? "ready" : "not_ready", capabilities: { codeAgent: codeAgentReady ? "ready" : "degraded" }, checks }, id, { status: ready ? 200 : 503 });
}
