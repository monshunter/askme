import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { Client, Pool, type PoolClient } from "pg";

import { analysisRunSseResponse, type AnalysisRunSnapshot } from "../src/server/code-agent/analysis-sse";

function discoverComposeDatabaseUrl() {
  const containerId = execFileSync("docker", ["compose", "ps", "-q", "db"], { encoding: "utf8" }).trim();
  if (!containerId) throw new Error("The local Compose PostgreSQL container is unavailable");
  const environment = execFileSync("docker", ["inspect", containerId, "--format", "{{range .Config.Env}}{{println .}}{{end}}"], { encoding: "utf8" });
  const values = new Map(environment.split("\n").flatMap((line) => {
    const separator = line.indexOf("=");
    return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)] as const] : [];
  }));
  const port = execFileSync("docker", ["compose", "port", "db", "5432"], { encoding: "utf8" }).trim().match(/:(\d+)$/)?.[1];
  const url = new URL("postgresql://127.0.0.1");
  url.username = values.get("POSTGRES_USER") ?? "";
  url.password = values.get("POSTGRES_PASSWORD") ?? "";
  url.port = port ?? "";
  url.pathname = `/${values.get("POSTGRES_DB") ?? ""}`;
  if (!url.username || !url.password || !url.port || url.pathname === "/") throw new Error("The local Compose PostgreSQL configuration is incomplete");
  return url;
}

function snapshotLoader(runId: string, ownerId: string, repositoryMustRemainVisible = false) {
  return async (client: PoolClient) => (await client.query<AnalysisRunSnapshot>(
    `SELECT run.id,run.version,run.state,run.phase,run.outcome,run.safe_error_code AS "safeErrorCode",run.assistant_message_id AS "assistantMessageId"
     FROM analysis_runs run JOIN repositories repository ON repository.id=run.repository_id AND repository.owner_id=run.owner_id
     WHERE run.id=$1 AND run.owner_id=$2 ${repositoryMustRemainVisible ? "AND repository.visibility<>'private'" : ""}`,
    [runId, ownerId],
  )).rows[0] ?? null;
}

function eventReader(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  return async () => {
    while (!buffered.includes("\n\n")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
    }
    const boundary = buffered.indexOf("\n\n");
    if (boundary < 0) return buffered;
    const event = buffered.slice(0, boundary + 2);
    buffered = buffered.slice(boundary + 2);
    return event;
  };
}

const base = discoverComposeDatabaseUrl();
const databaseName = `askme_sse_${randomUUID().replaceAll("-", "")}`;
const quotedDatabase = `"${databaseName}"`;
const adminUrl = new URL(base);
adminUrl.pathname = "/postgres";
const databaseUrl = new URL(base);
databaseUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: adminUrl.toString() });
let pool: Pool | null = null;
let connected = false;

try {
  await admin.connect();
  connected = true;
  await admin.query(`CREATE DATABASE ${quotedDatabase}`);
  pool = new Pool({ connectionString: databaseUrl.toString(), max: 8 });
  const migrations = (await readdir(path.resolve("migrations"))).filter((file) => file.endsWith(".sql")).sort();
  for (const migration of migrations) await pool.query(await readFile(path.resolve("migrations", migration), "utf8"));
  const ownerId = randomUUID();
  await pool.query("INSERT INTO users(id,email,password_hash,role,display_name) VALUES ($1,$2,'smoke','candidate','SSE Smoke')", [ownerId, `sse-${ownerId}@example.test`]);
  const contentKey = "a".repeat(64);
  await pool.query(
    `INSERT INTO repository_artifacts(content_key,checksum,manifest_checksum,storage_path,compressed_bytes,extracted_bytes,file_count,reference_count)
     VALUES ($1,$2,$3,$4,1,1,1,1)`,
    [contentKey, "b".repeat(64), "c".repeat(64), `aa/${contentKey}.tar.zst`],
  );
  const repository = await pool.query<{ id: string }>("INSERT INTO repositories(owner_id,canonical_url,display_name,visibility) VALUES ($1,'https://github.com/askme/sse','askme/sse','citation_allowed') RETURNING id", [ownerId]);
  const revision = await pool.query<{ id: string }>(
    `INSERT INTO repository_revisions(repository_id,owner_id,requested_ref,commit_sha,archive_checksum,artifact_key,filter_fingerprint,exclude_patterns,archive_bytes,extracted_bytes,file_count,state,stored_at)
     VALUES ($1,$2,'main',$3,$4,$5,$6,'[]'::jsonb,1,1,1,'stored',now()) RETURNING id`,
    [repository.rows[0]!.id, ownerId, "d".repeat(40), "e".repeat(64), contentKey, "f".repeat(64)],
  );
  async function createRun() {
    return (await pool!.query<{ id: string }>(
      `INSERT INTO analysis_runs(owner_id,purpose,repository_id,revision_id,idempotency_key,budget_snapshot,image_digest,skill_hash,prompt_version,profile_id,profile_fingerprint,configured_model)
       VALUES ($1,'repository_analysis',$2,$3,$4,'{}'::jsonb,$5,$6,'sse-v1','code',$7,'sse-model') RETURNING id`,
      [ownerId, repository.rows[0]!.id, revision.rows[0]!.id, createHash("sha256").update(randomUUID()).digest("hex"), `sha256:${"1".repeat(64)}`, "2".repeat(64), "3".repeat(64)],
    )).rows[0]!.id;
  }

  const runId = await createRun();
  const requestController = new AbortController();
  const response = await analysisRunSseResponse({ request: new Request("http://localhost/events", { signal: requestController.signal }), pool, runId, loadSnapshot: snapshotLoader(runId, ownerId) });
  const readEvent = eventReader(response);
  const initial = await readEvent();
  await pool.query("UPDATE analysis_runs SET state='running',phase='analyzing',version=version+1,started_at=now(),lease_expires_at=now()+interval '1 minute',lease_owner='sse-smoke' WHERE id=$1", [runId]);
  const running = await readEvent();
  await pool.query("UPDATE analysis_runs SET state='completed',phase='completed',outcome='answered',version=version+1,finished_at=now(),cleanup_completed_at=now(),lease_owner=NULL,lease_expires_at=NULL WHERE id=$1", [runId]);
  const completed = await readEvent();
  requestController.abort();
  if (!initial.includes('"state":"pending"') || !running.includes('"state":"running"') || !completed.includes('"state":"completed"') || !completed.includes('"completed":true')) {
    throw new Error("Analysis SSE did not deliver monotonic database snapshots");
  }

  const reconnectController = new AbortController();
  const reconnect = await analysisRunSseResponse({ request: new Request("http://localhost/events", { signal: reconnectController.signal }), pool, runId, loadSnapshot: snapshotLoader(runId, ownerId) });
  const reconnectEvent = await eventReader(reconnect)();
  reconnectController.abort();
  if (!reconnectEvent.includes('id: 3') || !reconnectEvent.includes('"state":"completed"')) throw new Error("Analysis SSE reconnect did not converge from the current snapshot");

  const revokedRunId = await createRun();
  const revokedController = new AbortController();
  const revoked = await analysisRunSseResponse({ request: new Request("http://localhost/events", { signal: revokedController.signal }), pool, runId: revokedRunId, loadSnapshot: snapshotLoader(revokedRunId, ownerId, true) });
  const readRevoked = eventReader(revoked);
  await readRevoked();
  await pool.query(
    `WITH hidden AS (UPDATE repositories SET visibility='private' WHERE id=$1)
     UPDATE analysis_runs SET cancel_requested_at=now(),cancel_reason='visibility_revoked',version=version+1 WHERE id=$2`,
    [repository.rows[0]!.id, revokedRunId],
  );
  const invalidated = await readRevoked();
  revokedController.abort();
  if (!invalidated.includes("event: invalidated") || /question|answerMarkdown|citations|source|tool|prompt|reasoning/i.test(invalidated)) {
    throw new Error("Analysis SSE authorization invalidation leaked or failed");
  }

  console.info(JSON.stringify({ event: "smoke.analysis-sse.completed", migrationsApplied: migrations.length, initialSnapshot: true, notifyWakeup: true, monotonicVersion: true, terminalClose: true, reconnectSnapshot: true, authorizationInvalidated: true, payloadSafe: true }));
} finally {
  if (pool) await pool.end().catch(() => undefined);
  if (connected) {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [databaseName]).catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${quotedDatabase}`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}
