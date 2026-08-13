import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";

function discoverComposeDatabaseUrl() {
  const containerId = execFileSync("docker", ["compose", "ps", "-q", "db"], { encoding: "utf8" }).trim();
  if (!containerId) throw new Error("The local Compose PostgreSQL container is unavailable");
  const environment = execFileSync("docker", ["inspect", containerId, "--format", "{{range .Config.Env}}{{println .}}{{end}}"], { encoding: "utf8" });
  const values = new Map(environment.split("\n").flatMap((line) => {
    const separator = line.indexOf("=");
    return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)] as const] : [];
  }));
  const published = execFileSync("docker", ["compose", "port", "db", "5432"], { encoding: "utf8" }).trim();
  const port = published.match(/:(\d+)$/)?.[1];
  if (!port || !values.get("POSTGRES_USER") || !values.get("POSTGRES_PASSWORD") || !values.get("POSTGRES_DB")) throw new Error("The local Compose PostgreSQL configuration is incomplete");
  const url = new URL("postgresql://127.0.0.1");
  url.username = values.get("POSTGRES_USER")!;
  url.password = values.get("POSTGRES_PASSWORD")!;
  url.port = port;
  url.pathname = `/${values.get("POSTGRES_DB")}`;
  return url.toString();
}

const sourceUrl = new URL(process.env.DATABASE_URL ?? discoverComposeDatabaseUrl());
if (!["127.0.0.1", "localhost", "::1"].includes(sourceUrl.hostname)) throw new Error("The Analysis Governance smoke may only target local PostgreSQL");
const databaseName = `askme_governance_${randomUUID().replaceAll("-", "")}`;
const adminUrl = new URL(sourceUrl); adminUrl.pathname = "/postgres";
const scratchUrl = new URL(sourceUrl); scratchUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: adminUrl.toString() });
let db: Client | null = null;

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  db = new Client({ connectionString: scratchUrl.toString() });
  await db.connect();
  const migrations = (await readdir(path.resolve("migrations"))).filter((file) => file.endsWith(".sql")).sort();
  for (const migration of migrations) {
    await db.query(await readFile(path.resolve("migrations", migration), "utf8"));
  }

  const adminId = randomUUID();
  const ownerId = randomUUID();
  await db.query("INSERT INTO users(id,email,password_hash,role,display_name) VALUES ($1,$2,'smoke','admin','Governance Admin'),($3,$4,'smoke','candidate','Governance Candidate')", [adminId, `${adminId}@example.test`, ownerId, `${ownerId}@example.test`]);
  const repository = await db.query<{ id: string }>(
    "INSERT INTO repositories(owner_id,canonical_url,display_name,visibility) VALUES ($1,'https://github.com/askme/governance','askme/governance','citation_allowed') RETURNING id", [ownerId],
  );
  const repositoryId = repository.rows[0]!.id;
  const artifactKey = "9".repeat(64);
  await db.query(
    `INSERT INTO repository_artifacts(content_key,checksum,manifest_checksum,storage_path,compressed_bytes,extracted_bytes,file_count,reference_count)
     VALUES ($1,$2,$3,$4,1,1,1,1)`,
    [artifactKey, "8".repeat(64), "7".repeat(64), `99/${artifactKey}.tar.zst`],
  );
  const revision = await db.query<{ id: string }>(
    `INSERT INTO repository_revisions(repository_id,owner_id,requested_ref,commit_sha,archive_checksum,artifact_key,filter_fingerprint,archive_bytes,extracted_bytes,file_count,state,stored_at)
     VALUES ($1,$2,'main',$3,$4,$5,$6,1,1,1,'stored',now()) RETURNING id`,
    [repositoryId, ownerId, "b".repeat(40), "c".repeat(64), artifactKey, "d".repeat(64)],
  );
  const revisionId = revision.rows[0]!.id;
  await db.query("UPDATE repositories SET active_revision_id=$2 WHERE id=$1", [repositoryId, revisionId]);
  const insertRun = () => db!.query<{ id: string }>(
    `INSERT INTO analysis_runs(owner_id,purpose,repository_id,revision_id,idempotency_key,state,phase,image_digest,skill_hash,prompt_version,profile_id,profile_fingerprint,configured_model,usage)
     VALUES ($1,'repository_analysis',$2,$3,$4,'pending','pending',$5,$6,'v1','code',$7,'model','{"toolCalls":3}'::jsonb) RETURNING id`,
    [ownerId, repositoryId, revisionId, randomBytes(32).toString("hex"), `sha256:${"a".repeat(64)}`, "e".repeat(64), "f".repeat(64)],
  );
  const firstRun = (await insertRun()).rows[0]!.id;

  const safeProjection = await db.query<{
    id: string; displayName: string; candidateName: string; activeCommitSha: string | null; runId: string | null; runState: string | null; safeErrorCode: string | null; toolCalls: number;
  }>(
    `SELECT repository.id,repository.display_name AS "displayName",candidate.display_name AS "candidateName",revision.commit_sha AS "activeCommitSha",
            latest.id AS "runId",latest.state AS "runState",latest.safe_error_code AS "safeErrorCode",coalesce((latest.usage->>'toolCalls')::int,0) AS "toolCalls"
     FROM repositories repository JOIN users candidate ON candidate.id=repository.owner_id
     LEFT JOIN repository_revisions revision ON revision.id=repository.active_revision_id
     LEFT JOIN LATERAL (SELECT id,state,safe_error_code,usage FROM analysis_runs WHERE repository_id=repository.id ORDER BY created_at DESC,id DESC LIMIT 1) latest ON true
     WHERE repository.id=$1`, [repositoryId],
  );
  if (safeProjection.rows[0]?.runId !== firstRun || safeProjection.rows[0]?.toolCalls !== 3) throw new Error("Admin Repository safe projection failed");
  const serializedProjection = JSON.stringify(safeProjection.rows[0]);
  if (["idempotencyKey", "cancelReason", "budgetSnapshot", "question", "answer", "sourcePath"].some((marker) => serializedProjection.includes(marker))) throw new Error("Admin projection exposed an unsafe field");

  await db.query("BEGIN");
  await db.query("UPDATE repositories SET disabled_at=now(),updated_at=now() WHERE id=$1 AND disabled_at IS NULL", [repositoryId]);
  await db.query(
    `WITH requested AS (
       UPDATE analysis_runs SET cancel_requested_at=now(),cancel_reason='repository_disabled',version=version+1,updated_at=now()
       WHERE owner_id=$1 AND repository_id=$2 AND state IN ('pending','running') AND cancel_requested_at IS NULL RETURNING id,version,state,phase
     ) INSERT INTO analysis_run_events(run_id,version,state,phase,safe_error_code)
       SELECT id,version,state,phase,'CODE_AGENT_CANCEL_REQUESTED' FROM requested`, [ownerId, repositoryId],
  );
  await db.query("COMMIT");
  const cancelled = await db.query<{ requested: boolean; events: number }>(
    `SELECT cancel_requested_at IS NOT NULL AS requested,(SELECT count(*)::int FROM analysis_run_events WHERE run_id=$1 AND safe_error_code='CODE_AGENT_CANCEL_REQUESTED') AS events
     FROM analysis_runs WHERE id=$1`, [firstRun],
  );
  if (!cancelled.rows[0]?.requested || cancelled.rows[0].events !== 1) throw new Error("Repository disable did not atomically request cancellation");
  const repeatedDisable = await db.query("UPDATE repositories SET disabled_at=now() WHERE id=$1 AND disabled_at IS NULL", [repositoryId]);
  if (repeatedDisable.rowCount !== 0) throw new Error("Repository disable was not idempotent");
  await db.query("UPDATE repositories SET disabled_at=NULL,updated_at=now() WHERE id=$1 AND disabled_at IS NOT NULL", [repositoryId]);

  const secondRun = (await insertRun()).rows[0]!.id;
  await db.query(
    `WITH requested AS (
       UPDATE analysis_runs SET cancel_requested_at=now(),cancel_reason='admin_cancelled',version=version+1,updated_at=now()
       WHERE id=$1 AND state IN ('pending','running') AND cancel_requested_at IS NULL RETURNING id,version,state,phase
     ) INSERT INTO analysis_run_events(run_id,version,state,phase,safe_error_code)
       SELECT id,version,state,phase,'CODE_AGENT_CANCEL_REQUESTED' FROM requested`, [secondRun],
  );
  const repeatedCancel = await db.query(
    "UPDATE analysis_runs SET version=version+1 WHERE id=$1 AND state IN ('pending','running') AND cancel_requested_at IS NULL", [secondRun],
  );
  if (repeatedCancel.rowCount !== 0) throw new Error("Analysis cancellation was not idempotent");

  await db.query(
    `INSERT INTO analysis_runner_heartbeats(runner_id,version,image_digest,artifact_ready,boxlite_ready,last_seen_at)
     VALUES ('governance-runner','0.1.0',$1,true,true,now())`, [`sha256:${"a".repeat(64)}`],
  );
  const health = await db.query<{ runnerReady: boolean; artifactReady: boolean; boxliteReady: boolean; runs: number; toolCalls: number }>(
    `SELECT EXISTS(SELECT 1 FROM analysis_runner_heartbeats WHERE last_seen_at>now()-interval '30 seconds') AS "runnerReady",
            coalesce((SELECT artifact_ready FROM analysis_runner_heartbeats ORDER BY last_seen_at DESC LIMIT 1),false) AS "artifactReady",
            coalesce((SELECT boxlite_ready FROM analysis_runner_heartbeats ORDER BY last_seen_at DESC LIMIT 1),false) AS "boxliteReady",
            (SELECT count(*)::int FROM analysis_runs WHERE created_at>=date_trunc('day',now())) AS runs,
            (SELECT coalesce(sum((usage->>'toolCalls')::int),0)::int FROM analysis_runs WHERE created_at>=date_trunc('day',now())) AS "toolCalls"`,
  );
  if (!health.rows[0]?.runnerReady || !health.rows[0].artifactReady || !health.rows[0].boxliteReady || health.rows[0].runs !== 2 || health.rows[0].toolCalls !== 6) {
    throw new Error("Runner health or usage projection failed");
  }

  console.info(JSON.stringify({ event: "smoke.analysis-governance.completed", migrationsApplied: migrations.length, safeProjection: true, disableCancellation: true, idempotentDisable: true, idempotentCancel: true, runnerHealth: true, analysisUsage: true }));
} finally {
  if (db) await db.end().catch(() => undefined);
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [databaseName]).catch(() => undefined);
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`).catch(() => undefined);
  await admin.end().catch(() => undefined);
}
