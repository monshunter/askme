import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { Client, Pool } from "pg";

import { claimNextAnalysisRun, failAnalysisRun } from "../src/server/code-agent/analysis-leases";
import { processAnalysisLease } from "../src/server/code-agent/analysis-runner";
import { queueRepositoryAnalysisRun, requestRepositoryAnalysisCancellation } from "../src/server/code-agent/analysis-runs";
import { codeAgentProfileFingerprint, codeAgentSkillHash } from "../src/server/code-agent/provenance";
import type { BoxliteCodeAgentSandbox } from "../src/server/code-agent/sandbox/boxlite-sandbox";
import { loadConfigFromSources, getRuntimeConfig } from "../src/server/config";
import { FileSystemRepositoryArtifactStore } from "../src/server/repositories/artifact-store";

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
  const user = values.get("POSTGRES_USER");
  const password = values.get("POSTGRES_PASSWORD");
  const database = values.get("POSTGRES_DB");
  if (!port || !user || !password || !database) throw new Error("The local Compose PostgreSQL configuration is incomplete");
  const url = new URL("postgresql://127.0.0.1");
  url.username = user;
  url.password = password;
  url.port = port;
  url.pathname = `/${database}`;
  return url.toString();
}

const currentDatabaseUrl = getRuntimeConfig().databaseUrl ?? discoverComposeDatabaseUrl();
const configuredUrl = new URL(currentDatabaseUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(configuredUrl.hostname)) throw new Error("The Analysis Scheduler smoke may only target local PostgreSQL");

const databaseName = `askme_analysis_${randomUUID().replaceAll("-", "")}`;
const quotedDatabase = `"${databaseName}"`;
const adminUrl = new URL(configuredUrl);
adminUrl.pathname = "/postgres";
const scratchUrl = new URL(configuredUrl);
scratchUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: adminUrl.toString() });
const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "askme-analysis-scheduler-"));
let pool: Pool | null = null;
let adminConnected = false;

try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`CREATE DATABASE ${quotedDatabase}`);
  pool = new Pool({ connectionString: scratchUrl.toString(), max: 8 });
  for (const migration of (await readdir(path.resolve("migrations"))).filter((file) => file.endsWith(".sql")).sort()) {
    await pool.query(await readFile(path.resolve("migrations", migration), "utf8"));
  }

  const config = loadConfigFromSources({
    DATABASE_URL: scratchUrl.toString(),
    ASKME_REPOSITORY_ARTIFACT_ROOT: artifactRoot,
    ASKME_CODE_AGENT_IMAGE_DIGEST: `sha256:${"d".repeat(64)}`,
    ASKME_CODE_AGENT_GLOBAL_CONCURRENCY: "2",
    ASKME_CODE_AGENT_REPOSITORY_DAILY_QUOTA: "2",
  }, "");
  const ownerId = randomUUID();
  await pool.query("INSERT INTO users(id,email,password_hash,role,display_name) VALUES ($1,$2,'smoke','candidate','Analysis Scheduler')", [ownerId, `analysis-${ownerId}@example.test`]);

  const zip = new JSZip();
  zip.file("fixture-root/src/index.ts", "export const answer = 42;\n");
  zip.file("fixture-root/README.md", "# Analysis scheduler fixture\n");
  const archive = new Uint8Array(await zip.generateAsync({ type: "uint8array", platform: "UNIX" }));
  const artifact = await new FileSystemRepositoryArtifactStore(artifactRoot).store({
    ownerId,
    canonicalUrl: "https://github.com/askme/analysis-scheduler",
    commitSha: "a".repeat(40),
    archive,
    archiveChecksum: createHash("sha256").update(archive).digest("hex"),
    excludePatterns: [],
  });
  const repository = await pool.query<{ id: string }>(
    "INSERT INTO repositories(owner_id,canonical_url,display_name,visibility) VALUES ($1,'https://github.com/askme/analysis-scheduler','askme/analysis-scheduler','citation_allowed') RETURNING id",
    [ownerId],
  );
  const repositoryId = repository.rows[0]!.id;
  await pool.query(
    `INSERT INTO repository_artifacts(content_key,checksum,manifest_checksum,storage_path,compressed_bytes,extracted_bytes,file_count,reference_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1)`,
    [artifact.contentKey, artifact.checksum, artifact.manifestChecksum, artifact.storagePath, artifact.compressedBytes, artifact.extractedBytes, artifact.fileCount],
  );
  const revision = await pool.query<{ id: string }>(
    `INSERT INTO repository_revisions(repository_id,owner_id,requested_ref,commit_sha,archive_checksum,artifact_key,filter_fingerprint,exclude_patterns,archive_bytes,extracted_bytes,file_count,state,stored_at)
     VALUES ($1,$2,'main',$3,$4,$5,$6,'[]'::jsonb,$7,$8,$9,'stored',now()) RETURNING id`,
    [repositoryId, ownerId, "a".repeat(40), createHash("sha256").update(archive).digest("hex"), artifact.contentKey, artifact.filterFingerprint, archive.byteLength, artifact.extractedBytes, artifact.fileCount],
  );
  const revisionId = revision.rows[0]!.id;

  const first = await queueRepositoryAnalysisRun({ pool, config, ownerId, repositoryId, revisionId, actorRole: "candidate" });
  const replay = await queueRepositoryAnalysisRun({ pool, config, ownerId, repositoryId, revisionId, actorRole: "candidate" });
  const rerun = await queueRepositoryAnalysisRun({ pool, config, ownerId, repositoryId, revisionId, explicitRerun: true, actorRole: "candidate" });
  if (first.id !== replay.id || !replay.replayed || rerun.id === first.id || rerun.analysisGeneration !== 1) throw new Error("Repository Analysis queue idempotency or explicit generation failed");
  let quotaCode: string | null = null;
  try {
    await queueRepositoryAnalysisRun({ pool, config, ownerId, repositoryId, revisionId, explicitRerun: true, actorRole: "candidate" });
  } catch (error) {
    quotaCode = error instanceof Error && "code" in error ? String(error.code) : null;
  }
  if (quotaCode !== "ANALYSIS_QUOTA_REPOSITORY_EXCEEDED") throw new Error("Repository Analysis daily quota was not enforced");

  const conversation = await pool.query<{ id: string }>("INSERT INTO conversations(owner_id,mode) VALUES ($1,'preview') RETURNING id", [ownerId]);
  const message = await pool.query<{ id: string }>(
    "INSERT INTO messages(conversation_id,owner_id,role,status,content) VALUES ($1,$2,'assistant','pending','') RETURNING id",
    [conversation.rows[0]!.id, ownerId],
  );
  const budget = config.codeAgent.budgets.conversationAnalysis;
  const skillHash = await codeAgentSkillHash("conversation_analysis");
  const fingerprint = codeAgentProfileFingerprint(config.ai.profiles.code, budget, config.codeAgent);
  const conversationRun = await pool.query<{ id: string }>(
    `INSERT INTO analysis_runs(owner_id,purpose,repository_id,revision_id,conversation_id,assistant_message_id,idempotency_key,state,priority,phase,budget_snapshot,
       image_digest,skill_hash,prompt_version,profile_id,profile_fingerprint,configured_model)
     VALUES ($1,'conversation_analysis',$2,$3,$4,$5,$6,'pending',100,'pending',$7::jsonb,$8,$9,$10,'code',$11,$12) RETURNING id`,
    [ownerId, repositoryId, revisionId, conversation.rows[0]!.id, message.rows[0]!.id, createHash("sha256").update(randomUUID()).digest("hex"), JSON.stringify(budget), config.codeAgent.imageDigest, skillHash, config.codeAgent.promptVersion, fingerprint, config.ai.profiles.code.model],
  );

  const realtime = await claimNextAnalysisRun(pool, { leaseOwner: "scheduler-smoke", leaseMs: 60_000, globalConcurrency: 2 });
  if (realtime?.runId !== conversationRun.rows[0]!.id || realtime.purpose !== "conversation_analysis") throw new Error("Conversation Analysis did not receive scheduling priority");
  const repositoryLease = await claimNextAnalysisRun(pool, { leaseOwner: "scheduler-smoke", leaseMs: 60_000, globalConcurrency: 2 });
  if (!repositoryLease || repositoryLease.purpose !== "repository_analysis") throw new Error("Repository Analysis did not use the non-reserved slot");
  const full = await claimNextAnalysisRun(pool, { leaseOwner: "scheduler-smoke", leaseMs: 60_000, globalConcurrency: 2 });
  if (full !== null) throw new Error("Global Analysis concurrency was not enforced");
  await failAnalysisRun(pool, realtime, { errorCode: "SMOKE_COMPLETE", cancelled: false, cleanupCompletedAt: new Date() });
  await failAnalysisRun(pool, repositoryLease, { errorCode: "SMOKE_COMPLETE", cancelled: false, cleanupCompletedAt: new Date() });

  await requestRepositoryAnalysisCancellation(pool, { ownerId, repositoryId, reason: "user_cancelled" });
  const afterCancellation = await claimNextAnalysisRun(pool, { leaseOwner: "scheduler-smoke", leaseMs: 60_000, globalConcurrency: 2 });
  if (afterCancellation !== null) throw new Error("A cancelled pending Analysis Run was leased");
  const states = await pool.query<{ state: string; count: number }>("SELECT state,count(*)::int AS count FROM analysis_runs GROUP BY state ORDER BY state");
  const cancelledCount = states.rows.find((row) => row.state === "cancelled")?.count ?? 0;
  if (cancelledCount < 1) throw new Error("Pending Analysis cancellation was not reconciled");
  const repositoryBudget = config.codeAgent.budgets.repositoryAnalysis;
  const repositorySkillHash = await codeAgentSkillHash("repository_analysis");
  const repositoryFingerprint = codeAgentProfileFingerprint(config.ai.profiles.code, repositoryBudget, config.codeAgent);

  async function insertExpiredRun(cancelRequested: boolean, microvmId: string) {
    return (await pool!.query<{ id: string }>(
      `INSERT INTO analysis_runs(owner_id,purpose,repository_id,revision_id,idempotency_key,state,priority,phase,lease_owner,lease_expires_at,
         cancel_requested_at,cancel_reason,microvm_id,budget_snapshot,image_digest,skill_hash,prompt_version,profile_id,profile_fingerprint,configured_model)
       VALUES ($1,'repository_analysis',$2,$3,$4,'running',0,'analyzing','crashed-runner',now()-interval '1 minute',
         CASE WHEN $5 THEN now() ELSE NULL END,CASE WHEN $5 THEN 'user_cancelled' ELSE NULL END,$6,$7::jsonb,$8,$9,$10,'code',$11,$12)
       RETURNING id`,
      [ownerId, repositoryId, revisionId, createHash("sha256").update(randomUUID()).digest("hex"), cancelRequested, microvmId, JSON.stringify(repositoryBudget), config.codeAgent.imageDigest, repositorySkillHash, config.codeAgent.promptVersion, repositoryFingerprint, config.ai.profiles.code.model],
    )).rows[0]!.id;
  }

  const expiredRunId = await insertExpiredRun(false, "stale-microvm-retry");
  const recovered = await claimNextAnalysisRun(pool, { leaseOwner: "recovery-runner", leaseMs: 60_000, globalConcurrency: 2 });
  if (recovered?.runId !== expiredRunId || recovered.staleMicrovmId !== "stale-microvm-retry") throw new Error("An expired Analysis lease was not reclaimed with its stale microVM identity");
  await failAnalysisRun(pool, recovered, { errorCode: "SMOKE_RECOVERED", cancelled: false, cleanupCompletedAt: new Date() });

  const cancelledExpiredRunId = await insertExpiredRun(true, "stale-microvm-cancel");
  const recoveredCancellation = await claimNextAnalysisRun(pool, { leaseOwner: "recovery-runner", leaseMs: 60_000, globalConcurrency: 2 });
  if (recoveredCancellation?.runId !== cancelledExpiredRunId || recoveredCancellation.staleMicrovmId !== "stale-microvm-cancel" || !recoveredCancellation.cancelRequested) {
    throw new Error("An expired cancelled Analysis lease was not reclaimed for stale microVM cleanup");
  }
  const removedMicrovms: string[] = [];
  const recoverySandbox = {
    removeStaleMicrovm: async (microvmId: string) => { removedMicrovms.push(microvmId); },
    run: async () => { throw new Error("A cancelled recovered run must not start another microVM"); },
  } as unknown as BoxliteCodeAgentSandbox;
  let recoveryCode: string | null = null;
  try {
    await processAnalysisLease({ pool, config, sandbox: recoverySandbox, lease: recoveredCancellation });
  } catch (error) {
    recoveryCode = error instanceof Error && "code" in error ? String(error.code) : null;
  }
  const recoveredState = await pool.query<{ state: string; cleanupCompleted: boolean }>(
    "SELECT state,cleanup_completed_at IS NOT NULL AS \"cleanupCompleted\" FROM analysis_runs WHERE id=$1", [cancelledExpiredRunId],
  );
  if (recoveryCode !== "CODE_AGENT_CANCELLED" || removedMicrovms[0] !== "stale-microvm-cancel" || recoveredState.rows[0]?.state !== "cancelled" || !recoveredState.rows[0].cleanupCompleted) {
    throw new Error("Recovered cancellation did not clean the stale microVM before reaching the cancelled terminal state");
  }

  console.info(JSON.stringify({
    event: "smoke.analysis-scheduler.completed",
    migrationsApplied: true,
    implicitQueueIdempotent: true,
    explicitRerunGeneration: rerun.analysisGeneration,
    realtimePriority: true,
    repositorySlotReserved: true,
    globalConcurrencyEnforced: true,
    dailyQuotaEnforced: true,
    pendingCancellationReconciled: true,
    expiredLeaseRecovered: true,
    expiredCancellationRecovered: true,
    staleMicrovmCleanupBeforeCancellation: true,
  }));
} finally {
  if (pool) await pool.end().catch(() => undefined);
  await rm(artifactRoot, { recursive: true, force: true });
  if (adminConnected) {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [databaseName]).catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${quotedDatabase}`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}
