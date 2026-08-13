import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { JsBoxlite } from "@boxlite-ai/boxlite";
import JSZip from "jszip";
import { Client, Pool } from "pg";

import { claimNextAnalysisRun } from "../src/server/code-agent/analysis-leases";
import { processAnalysisLease } from "../src/server/code-agent/analysis-runner";
import { queueConversationAnalysisRun, queueRepositoryAnalysisRun } from "../src/server/code-agent/analysis-runs";
import { BoxliteCodeAgentSandbox } from "../src/server/code-agent/sandbox/boxlite-sandbox";
import { loadConfigFromSources } from "../src/server/config";
import { FileSystemRepositoryArtifactStore } from "../src/server/repositories/artifact-store";
import { citationContentHash } from "../src/server/repositories/dossier-output";
import { approveCandidateRepositoryDossier } from "../src/server/repositories/dossier-review-service";
import { loadRepositorySourcePreview } from "../src/server/repositories/source-preview";

const rootfsPath = process.env.ASKME_CODE_AGENT_ROOTFS_PATH?.trim();
const imageDigest = process.env.ASKME_CODE_AGENT_IMAGE_DIGEST?.trim();
if (!rootfsPath || !imageDigest) throw new Error("ASKME_CODE_AGENT_ROOTFS_PATH and ASKME_CODE_AGENT_IMAGE_DIGEST are required");

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

const source = "export const answer = 42;\nexport function readAnswer() {\n  return answer;\n}\n";
const citationHash = citationContentHash(source, 1, 1);
const wikiMarkdown = [
  "# Runner Wiki", "", "## Overview", "The module exports an answer. [S1]", "", "## Architecture", "The source module owns the exported value. [S1]",
  "```mermaid", "flowchart LR", "  Consumer --> Module", "```", "", "## Modules", "`src/index.ts` contains the value. [S1]", "",
  "## Workflow", "The reader returns the exported value. [S1]", "", "## Operations", "This analysis did not execute the module. [S1]", "",
  "## Limitations and uncovered areas", "Only one source file was examined by this fixture.",
].join("\n");
const hostAddress = execFileSync("ipconfig", ["getifaddr", "en0"], { encoding: "utf8" }).trim();
const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "askme-analysis-runner-artifact-"));
const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "askme-analysis-runner-runtime-"));
const databaseName = `askme_runner_${randomUUID().replaceAll("-", "")}`;
const quotedDatabase = `"${databaseName}"`;
const baseDatabaseUrl = discoverComposeDatabaseUrl();
const adminUrl = new URL(baseDatabaseUrl);
adminUrl.pathname = "/postgres";
const databaseUrl = new URL(baseDatabaseUrl);
databaseUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: adminUrl.toString() });
let adminConnected = false;
let pool: Pool | null = null;
let requests = 0;
const secret = `runner-smoke-${randomUUID()}`;

function event(response: import("node:http").ServerResponse, value: unknown) {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

const server = createServer(async (request, response) => {
  if (request.url !== "/v1/chat/completions" || request.method !== "POST" || request.headers.authorization !== `Bearer ${secret}`) {
    response.writeHead(403).end();
    return;
  }
  requests += 1;
  for await (const chunk of request) {
    // Consume without retaining prompt/tool content.
    void chunk;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  const base = { id: `runner-${requests}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1_000), model: "runner-smoke-model" };
  if (requests === 1 || requests === 4) {
    event(response, { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "runner-read", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "src/index.ts", lineStart: 1, lineCount: 1 }) } }] }, finish_reason: null }] });
    event(response, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 70, completion_tokens: 20, total_tokens: 90 } });
  } else if (requests === 2) {
    event(response, { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "runner-write", type: "function", function: { name: "write_wiki", arguments: JSON.stringify({ path: "overview.md", content: wikiMarkdown }) } }] }, finish_reason: null }] });
    event(response, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 } });
  } else if (requests === 3) {
    const wiki = {
      title: "Runner Wiki",
      summary: "A Wiki generated by the complete isolated Repository Analysis Runner.",
      pages: [{ path: "overview.md", title: "Overview", order: 0 }],
      citations: [{ marker: "S1", pagePath: "overview.md", path: "src/index.ts", lineStart: 1, lineEnd: 1, contentHash: citationHash }],
      coverage: { analysisMode: "targeted", coveredAreas: ["overview", "architecture", "modules", "workflow", "operations"] },
    };
    event(response, { ...base, choices: [{ index: 0, delta: { role: "assistant", content: JSON.stringify(wiki) }, finish_reason: null }] });
    event(response, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 90, completion_tokens: 60, total_tokens: 150 } });
  } else {
    const answer = {
      outcome: "answered",
      answerMarkdown: "The inspected module exports the numeric constant `42`.",
      citations: [{ path: "src/index.ts", lineStart: 1, lineEnd: 1, contentHash: citationHash }],
    };
    event(response, { ...base, choices: [{ index: 0, delta: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: null }] });
    event(response, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 } });
  }
  response.end("data: [DONE]\n\n");
});

await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("The runner smoke AI endpoint did not bind");

try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`CREATE DATABASE ${quotedDatabase}`);
  pool = new Pool({ connectionString: databaseUrl.toString(), max: 8 });
  for (const migration of (await readdir(path.resolve("migrations"))).filter((file) => file.endsWith(".sql")).sort()) {
    await pool.query(await readFile(path.resolve("migrations", migration), "utf8"));
  }
  const config = loadConfigFromSources({
    DATABASE_URL: databaseUrl.toString(),
    ASKME_REPOSITORY_ARTIFACT_ROOT: artifactRoot,
    ASKME_CODE_AGENT_ROOTFS_PATH: rootfsPath,
    ASKME_CODE_AGENT_RUNTIME_ROOT: runtimeRoot,
    ASKME_CODE_AGENT_IMAGE_DIGEST: imageDigest,
    ASKME_AI_BASE_URL: `http://${hostAddress}:${address.port}/v1`,
    ASKME_AI_API_KEY: secret,
    ASKME_AI_CODE_MODEL: "runner-smoke-model",
    ASKME_AI_CODE_THINKING: "off",
  }, "");
  const ownerId = randomUUID();
  await pool.query("INSERT INTO users(id,email,password_hash,role,display_name) VALUES ($1,$2,'smoke','candidate','Runner Smoke')", [ownerId, `runner-${ownerId}@example.test`]);
  const zip = new JSZip();
  zip.file("fixture-root/src/index.ts", source);
  zip.file("fixture-root/README.md", "# Runner smoke\n");
  const archive = new Uint8Array(await zip.generateAsync({ type: "uint8array", platform: "UNIX" }));
  const artifact = await new FileSystemRepositoryArtifactStore(artifactRoot).store({ ownerId, canonicalUrl: "https://github.com/askme/runner-smoke", commitSha: "e".repeat(40), archive, archiveChecksum: createHash("sha256").update(archive).digest("hex"), excludePatterns: [] });
  await artifact.ensureStored();
  await pool.query("INSERT INTO repository_artifacts(content_key,checksum,manifest_checksum,storage_path,compressed_bytes,extracted_bytes,file_count,reference_count) VALUES ($1,$2,$3,$4,$5,$6,$7,1)", [artifact.contentKey, artifact.checksum, artifact.manifestChecksum, artifact.storagePath, artifact.compressedBytes, artifact.extractedBytes, artifact.fileCount]);
  const repository = await pool.query<{ id: string }>("INSERT INTO repositories(owner_id,canonical_url,display_name,visibility) VALUES ($1,'https://github.com/askme/runner-smoke','askme/runner-smoke','citation_allowed') RETURNING id", [ownerId]);
  const revision = await pool.query<{ id: string }>(
    `INSERT INTO repository_revisions(repository_id,owner_id,requested_ref,commit_sha,archive_checksum,artifact_key,filter_fingerprint,exclude_patterns,archive_bytes,extracted_bytes,file_count,state,stored_at)
     VALUES ($1,$2,'main',$3,$4,$5,$6,'[]'::jsonb,$7,$8,$9,'stored',now()) RETURNING id`,
    [repository.rows[0]!.id, ownerId, "e".repeat(40), createHash("sha256").update(archive).digest("hex"), artifact.contentKey, artifact.filterFingerprint, archive.byteLength, artifact.extractedBytes, artifact.fileCount],
  );
  const queued = await queueRepositoryAnalysisRun({ pool, config, ownerId, repositoryId: repository.rows[0]!.id, revisionId: revision.rows[0]!.id, actorRole: "candidate" });
  const lease = await claimNextAnalysisRun(pool, { leaseOwner: "runner-smoke", leaseMs: config.codeAgent.leaseMs, globalConcurrency: config.codeAgent.globalConcurrency });
  if (!lease || lease.runId !== queued.id) throw new Error("The queued Repository Analysis Run was not leased");
  const runtime = new JsBoxlite({ homeDir: runtimeRoot });
  const sandbox = new BoxliteCodeAgentSandbox(config.codeAgent, runtime);
  try {
    const completed = await processAnalysisLease({ pool, config, sandbox, lease });
    if (!("generatedVersion" in completed)) throw new Error("Repository Analysis completed without a Dossier version");
    const terminal = await pool.query<{ state: string; outcome: string; phase: string; dossierCount: number; citationCount: number }>(
      `SELECT run.state,run.outcome,run.phase,
        (SELECT count(*)::int FROM repository_dossiers WHERE analysis_run_id=run.id) AS "dossierCount",
        (SELECT count(*)::int FROM repository_wiki_citations citation JOIN repository_dossiers dossier ON dossier.id=citation.dossier_id WHERE dossier.analysis_run_id=run.id) AS "citationCount"
       FROM analysis_runs run WHERE run.id=$1`,
      [queued.id],
    );
    const state = terminal.rows[0];
    if (completed.generatedVersion !== 1 || state?.state !== "completed" || state.outcome !== "answered" || state.phase !== "review_pending" || state.dossierCount !== 1 || state.citationCount !== 1 || requests !== 3 || (await runtime.listInfo()).length !== 0) {
      throw new Error("The Repository Analysis Runner terminal transaction is inconsistent");
    }
    await approveCandidateRepositoryDossier({ pool, artifactRoot, ownerId, repositoryId: repository.rows[0]!.id, dossierId: completed.dossierId });
    const clientMessageId = randomUUID();
    const conversation = await pool.query<{ id: string }>("INSERT INTO conversations(owner_id,mode) VALUES ($1,'preview') RETURNING id", [ownerId]);
    const question = await pool.query<{ id: string }>(
      "INSERT INTO messages(conversation_id,owner_id,role,status,client_message_id,content) VALUES ($1,$2,'user','completed',$3,'What value does the inspected module export?') RETURNING id",
      [conversation.rows[0]!.id, ownerId, clientMessageId],
    );
    const assistant = await pool.query<{ id: string }>(
      "INSERT INTO messages(conversation_id,owner_id,role,status,reply_to_message_id,content) VALUES ($1,$2,'assistant','pending',$3,'') RETURNING id",
      [conversation.rows[0]!.id, ownerId, question.rows[0]!.id],
    );
    const conversationRun = await queueConversationAnalysisRun({
      pool, config, ownerId, repositoryId: repository.rows[0]!.id, conversationId: conversation.rows[0]!.id,
      assistantMessageId: assistant.rows[0]!.id, clientMessageId, actorRole: "candidate",
    });
    const replay = await queueConversationAnalysisRun({
      pool, config, ownerId, repositoryId: repository.rows[0]!.id, conversationId: conversation.rows[0]!.id,
      assistantMessageId: assistant.rows[0]!.id, clientMessageId, actorRole: "candidate",
    });
    if (!replay.replayed || replay.id !== conversationRun.id) throw new Error("Conversation Analysis queue was not idempotent");
    const conversationLease = await claimNextAnalysisRun(pool, { leaseOwner: "runner-smoke", leaseMs: config.codeAgent.leaseMs, globalConcurrency: config.codeAgent.globalConcurrency });
    if (!conversationLease || conversationLease.runId !== conversationRun.id || conversationLease.userQuestion !== "What value does the inspected module export?") {
      throw new Error("The Conversation Analysis Run was not leased with its persisted question");
    }
    const conversationCompleted = await processAnalysisLease({ pool, config, sandbox, lease: conversationLease });
    if (!("messageId" in conversationCompleted)) throw new Error("Conversation Analysis completed without a final message");
    const conversationTerminal = await pool.query<{ runState: string; outcome: string; messageStatus: string; errorCode: string | null; citationCount: number; dossierCount: number }>(
      `SELECT run.state AS "runState",run.outcome,message.status AS "messageStatus",message.error_code AS "errorCode",
              (SELECT count(*)::int FROM repository_message_citations WHERE message_id=message.id) AS "citationCount",
              (SELECT count(*)::int FROM repository_dossiers WHERE analysis_run_id=run.id) AS "dossierCount"
       FROM analysis_runs run JOIN messages message ON message.id=run.assistant_message_id WHERE run.id=$1`,
      [conversationRun.id],
    );
    const conversationState = conversationTerminal.rows[0];
    if (conversationState?.runState !== "completed" || conversationState.outcome !== "answered" || conversationState.messageStatus !== "completed" || conversationState.errorCode !== null || conversationState.citationCount !== 1 || conversationState.dossierCount !== 0 || Number(requests) !== 5 || (await runtime.listInfo()).length !== 0) {
      throw new Error("The Conversation Analysis terminal message transaction is inconsistent");
    }
    const preview = await loadRepositorySourcePreview({
      pool, artifactRoot, repositoryId: repository.rows[0]!.id,
      citation: { messageId: assistant.rows[0]!.id, revisionId: revision.rows[0]!.id, path: "src/index.ts", lineStart: 1, lineEnd: 1 },
      authorization: { mode: "candidate", ownerId },
    });
    if (preview.content !== "export const answer = 42;" || preview.contentHash !== citationHash) throw new Error("The immutable Repository source preview is inconsistent");
    console.info(JSON.stringify({ event: "smoke.repository-analysis-runner.completed", queued: true, leased: true, boxlitePiCompleted: true, hostCitationValidated: true, microvmRemovedBeforeCommit: true, dossierPersisted: true, conversationQueuedIdempotently: true, conversationMessagePersisted: true, deepConclusionExcludedFromDossier: true, immutableSourcePreview: true, terminalState: state.state }));
  } finally {
    await sandbox.close().catch(() => undefined);
  }
} finally {
  if (pool) await pool.end().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(artifactRoot, { recursive: true, force: true });
  await rm(runtimeRoot, { recursive: true, force: true });
  if (adminConnected) {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [databaseName]).catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${quotedDatabase}`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}
