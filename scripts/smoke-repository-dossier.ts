import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { Pool } from "pg";

import { retrieveUnifiedEvidence } from "../src/server/agent/evidence-provider";
import { hashPassword } from "../src/server/auth/crypto";
import { FileSystemRepositoryArtifactStore } from "../src/server/repositories/artifact-store";
import { citationContentHash } from "../src/server/repositories/dossier-output";
import { completeRepositoryAnalysisRun } from "../src/server/repositories/dossier-service";
import {
  approveCandidateRepositoryDossier,
  getCandidateActiveRepositoryKnowledge,
  getCandidateRepositoryDossier,
  markRepositoryDossiersOutdated,
  updateCandidateWikiProjectionPage,
} from "../src/server/repositories/dossier-review-service";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";
const databaseUrl = new URL(connectionString);
if (!["127.0.0.1", "localhost", "::1", "db"].includes(databaseUrl.hostname)) throw new Error("The Repository Wiki smoke may only target a local database");

const pool = new Pool({ connectionString });
const configuredArtifactRoot = process.env.ASKME_REPOSITORY_ARTIFACT_ROOT?.trim();
const artifactRoot = configuredArtifactRoot ?? await mkdtemp(path.join(os.tmpdir(), "askme-repository-wiki-smoke-"));
const temporaryArtifactRoot = configuredArtifactRoot === undefined;
if (configuredArtifactRoot) await mkdir(artifactRoot, { recursive: true });
const keepFixture = process.env.ASKME_KEEP_DOSSIER_FIXTURE === "true";
const ownerId = randomUUID();
const candidateEmail = process.env.ASKME_CANDIDATE_EMAIL?.trim().toLowerCase() ?? `repository-wiki-${ownerId}@example.test`;
const candidatePassword = process.env.ASKME_CANDIDATE_PASSWORD ?? "Repository-wiki-2026!";
let artifactKey: string | null = null;
let artifactStoragePath: string | null = null;
const artifactStore = new FileSystemRepositoryArtifactStore(artifactRoot);

const source = "export const answer = 42;\nexport function read() {\n  return answer;\n}\n";
const commitSha = "b".repeat(40);
const wikiMarkdown = [
  "# Repository Wiki", "", "## Project overview", "This repository exports an answer for consumers. [S1]", "",
  "## Architecture", "The source module owns the exported value and reader. [S1]", "```mermaid", "flowchart LR", "  Consumer --> Module", "```", "",
  "## Module map", "`src/index.ts` contains the exported value. [S1]", "", "## Key workflow", "The reader returns the exported value. [S1]", "",
  "## Build and operations", "The immutable source establishes the module boundary; this smoke does not execute it. [S1]", "",
  "## Limitations and uncovered areas", "Only one representative source file is examined; compilation and runtime behavior are not claimed.",
].join("\n");

try {
  const zip = new JSZip();
  zip.file("repository-root/src/index.ts", source);
  zip.file("repository-root/README.md", "# Repository Wiki smoke\n");
  zip.file("repository-root/.env", "SECRET=excluded\n");
  const archive = new Uint8Array(await zip.generateAsync({ type: "uint8array", platform: "UNIX" }));
  const artifact = await artifactStore.store({
    ownerId,
    canonicalUrl: "https://github.com/askme/wiki-smoke",
    commitSha,
    archive,
    archiveChecksum: createHash("sha256").update(archive).digest("hex"),
    excludePatterns: [],
  });
  artifactKey = artifact.contentKey;
  artifactStoragePath = artifact.storagePath;

  await pool.query("INSERT INTO users(id,email,password_hash,role,display_name) VALUES ($1,$2,$3,'candidate','Repository Wiki Smoke')", [ownerId, candidateEmail, await hashPassword(candidatePassword)]);
  await pool.query(
    `INSERT INTO knowledge_items(owner_id,type,title,summary,highlights,confidence)
     VALUES ($1,'project','Repository Wiki smoke companion','Legacy Knowledge Item used to prove unified pagination.','[]'::jsonb,1)`,
    [ownerId],
  );
  await pool.query(
    `INSERT INTO repository_artifacts(content_key,checksum,manifest_checksum,storage_path,compressed_bytes,extracted_bytes,file_count,reference_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1)`,
    [artifact.contentKey, artifact.checksum, artifact.manifestChecksum, artifact.storagePath, artifact.compressedBytes, artifact.extractedBytes, artifact.fileCount],
  );
  const repositoryId = (await pool.query<{ id: string }>(
    `INSERT INTO repositories(owner_id,canonical_url,display_name,visibility)
     VALUES ($1,'https://github.com/askme/wiki-smoke','askme/wiki-smoke','citation_allowed') RETURNING id`,
    [ownerId],
  )).rows[0]!.id;

  async function createRevisionAndRun(analysisGeneration: number, existingRevisionId?: string) {
    const revisionId = existingRevisionId ?? (await pool.query<{ id: string }>(
      `INSERT INTO repository_revisions(repository_id,owner_id,requested_ref,commit_sha,archive_checksum,artifact_key,filter_fingerprint,exclude_patterns,archive_bytes,extracted_bytes,file_count,state,stored_at)
       VALUES ($1,$2,'main',$3,$4,$5,$6,'[]'::jsonb,$7,$8,$9,'stored',now()) RETURNING id`,
      [repositoryId, ownerId, commitSha, createHash("sha256").update(archive).digest("hex"), artifact.contentKey, artifact.filterFingerprint, archive.byteLength, artifact.extractedBytes, artifact.fileCount],
    )).rows[0]!.id;
    const runId = (await pool.query<{ id: string }>(
      `INSERT INTO analysis_runs(
         owner_id,purpose,repository_id,revision_id,idempotency_key,analysis_generation,state,priority,version,phase,lease_owner,lease_expires_at,
         budget_snapshot,image_digest,skill_hash,prompt_version,profile_id,profile_fingerprint,configured_model,microvm_id,started_at
       ) VALUES ($1,'repository_analysis',$2,$3,$4,$5,'running',0,2,'analyzing','wiki-smoke-runner',now()+interval '5 minutes',
         '{"maxRounds":50}'::jsonb,'sha256:wiki-smoke',$6,'repository-wiki-v1','code',$7,'deepseek-v4-pro','microvm-smoke',now()) RETURNING id`,
      [ownerId, repositoryId, revisionId, createHash("sha256").update(`${ownerId}:${revisionId}:${analysisGeneration}`).digest("hex"), analysisGeneration, "d".repeat(64), "e".repeat(64)],
    )).rows[0]!.id;
    return { revisionId, runId };
  }

  const wikiOutput = {
    title: "Repository Wiki",
    summary: "A generated Wiki fixture used to prove approval and unified knowledge retrieval.",
    pages: [{ path: "overview.md", title: "Overview", order: 0 }],
    citations: [{ marker: "S1", pagePath: "overview.md", path: "src/index.ts", lineStart: 1, lineEnd: 1, contentHash: citationContentHash(source, 1, 1) }],
    coverage: {
      analysisMode: "targeted",
      eligibleFileCount: artifact.fileCount,
      examinedFileCount: 1,
      examinedPaths: ["src/index.ts"],
      coveredAreas: ["overview", "architecture", "modules", "workflow", "operations"],
      skipped: [{ reason: "scope", count: artifact.fileCount - 1 }],
    },
  };
  const wikiFiles = new Map([["overview.md", wikiMarkdown]]);
  const first = await createRevisionAndRun(0);
  const completed = await completeRepositoryAnalysisRun({
    pool, artifactRoot, runId: first.runId, leaseOwner: "wiki-smoke-runner", output: wikiOutput, wikiFiles,
    actualModel: "deepseek-v4-pro-smoke", usage: { inputTokens: 120, outputTokens: 80, toolCalls: 3 }, cleanupCompletedAt: new Date(),
  });
  const replay = await completeRepositoryAnalysisRun({
    pool, artifactRoot, runId: first.runId, leaseOwner: "expired-after-completion", output: { ignored: true }, wikiFiles: new Map(),
    actualModel: "ignored-on-replay", usage: {}, cleanupCompletedAt: new Date(),
  });
  if (!replay.replayed || replay.dossierId !== completed.dossierId || replay.generatedVersion !== 1) throw new Error("Repository Wiki completion replay was not idempotent");

  const stored = await pool.query<{ dossierCount: number; pageCount: number; citationCount: number; runState: string; runVersion: number }>(
    `SELECT
       (SELECT count(*)::int FROM repository_dossiers WHERE analysis_run_id=$1) AS "dossierCount",
       (SELECT count(*)::int FROM repository_wiki_pages page JOIN repository_dossiers dossier ON dossier.id=page.dossier_id WHERE dossier.analysis_run_id=$1) AS "pageCount",
       (SELECT count(*)::int FROM repository_wiki_citations citation JOIN repository_dossiers dossier ON dossier.id=citation.dossier_id WHERE dossier.analysis_run_id=$1) AS "citationCount",
       run.state AS "runState",run.version AS "runVersion"
     FROM analysis_runs run WHERE run.id=$1`,
    [first.runId],
  );
  if (stored.rows[0]?.dossierCount !== 1 || stored.rows[0].pageCount !== 1 || stored.rows[0].citationCount !== 1 || stored.rows[0].runState !== "completed") {
    throw new Error("Repository Wiki completion was not stored atomically");
  }

  const review = await getCandidateRepositoryDossier(pool, ownerId, repositoryId);
  const page = review.dossier?.pages[0];
  if (!review.dossier || review.dossier.isActive || !page || !page.generatedMarkdown.includes("# Repository Wiki")) throw new Error("Generated Repository Wiki review is incomplete");
  const editedMarkdown = wikiMarkdown.replace("exports an answer for consumers", "exports the approved answer for consumers");
  const edited = await updateCandidateWikiProjectionPage({ pool, ownerId, repositoryId, change: { pageId: page.id, editedMarkdown }, requestId: "wiki-smoke-edit" });
  if (edited.page.editedMarkdown !== editedMarkdown) throw new Error("Repository Wiki page projection was not edited");
  const firstApproval = await approveCandidateRepositoryDossier({ pool, artifactRoot, ownerId, repositoryId, dossierId: review.dossier.id, requestId: "wiki-smoke-approve-v1" });
  const active = await getCandidateRepositoryDossier(pool, ownerId, repositoryId);
  if (!active.dossier?.isActive || active.dossier.pages[0]?.editedMarkdown !== editedMarkdown) throw new Error("Approved Repository Wiki projection did not activate");

  const evidence = await retrieveUnifiedEvidence(pool, ownerId, "candidate_preview", { query: "approved answer", limit: 8 });
  if (!evidence.some((item) => "repositoryWikiPageId" in item && item.repositoryWikiPageId === page.id && item.sourceCitations.length === 1)) {
    throw new Error("Approved Repository Wiki did not join the unified knowledge retrieval path");
  }
  const publicEvidence = await retrieveUnifiedEvidence(pool, ownerId, "public_answer", { query: "approved answer", limit: 8 });
  if (!publicEvidence.some((item) => "repositoryWikiPageId" in item && item.repositoryWikiPageId === page.id && item.sourceCitations.length === 1)) {
    throw new Error("Citation-authorized Repository Wiki did not join the Public Agent retrieval path");
  }

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: candidateEmail, password: candidatePassword }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  if (login.status !== 200 || !cookie) throw new Error(`Repository Wiki smoke login failed with ${login.status}`);
  type Envelope<T> = { data: T | null; error: { code: string; message: string } | null };
  async function request<T>(pathname: string, init?: RequestInit) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers: { cookie: cookie!, ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
    });
    return { response, payload: await response.json() as Envelope<T> };
  }
  type KnowledgeListItem = { id: string; sourceKind: string; type: string; wikiPageCount: number | null };
  const firstKnowledgePage = await request<{ items: KnowledgeListItem[]; counts: Record<string, number>; total: number }>("/api/knowledge?page=1&pageSize=1&status=active");
  const secondKnowledgePage = await request<{ items: KnowledgeListItem[]; counts: Record<string, number>; total: number }>("/api/knowledge?page=2&pageSize=1&status=active");
  if (
    firstKnowledgePage.response.status !== 200
    || secondKnowledgePage.response.status !== 200
    || firstKnowledgePage.payload.data?.total !== 2
    || secondKnowledgePage.payload.data?.total !== 2
    || firstKnowledgePage.payload.data.items[0]?.id === secondKnowledgePage.payload.data.items[0]?.id
    || firstKnowledgePage.payload.data.counts.project !== 1
    || firstKnowledgePage.payload.data.counts.repository !== 1
  ) throw new Error("Knowledge Item and Approved Repository Wiki did not share one paginated read model");
  const repositoryKnowledge = await request<{ items: KnowledgeListItem[]; total: number }>("/api/knowledge?type=repository&status=active&citationReady=true&search=approved%20answer");
  const repositoryKnowledgeItem = repositoryKnowledge.payload.data?.items.find((item) => item.id === repositoryId && item.sourceKind === "repository_wiki");
  if (repositoryKnowledge.response.status !== 200 || repositoryKnowledge.payload.data?.total !== 1 || repositoryKnowledgeItem?.wikiPageCount !== 1) {
    throw new Error("Approved Repository Wiki was not searchable and filterable in Candidate Knowledge");
  }
  const activeKnowledge = await request<Awaited<ReturnType<typeof getCandidateActiveRepositoryKnowledge>>>(`/api/knowledge/repositories/${repositoryId}`);
  if (activeKnowledge.response.status !== 200 || activeKnowledge.payload.data?.dossier.id !== review.dossier.id || activeKnowledge.payload.data.dossier.pages[0]?.editedMarkdown !== editedMarkdown) {
    throw new Error("Candidate Knowledge detail did not follow the active approved Wiki projection");
  }

  const second = await createRevisionAndRun(1, first.revisionId);
  const secondCompletion = await completeRepositoryAnalysisRun({
    pool, artifactRoot, runId: second.runId, leaseOwner: "wiki-smoke-runner", output: wikiOutput, wikiFiles,
    actualModel: "deepseek-v4-pro-smoke", usage: { inputTokens: 100, outputTokens: 70 }, cleanupCompletedAt: new Date(),
  });
  const pending = await getCandidateRepositoryDossier(pool, ownerId, repositoryId);
  if (!pending.dossier || pending.dossier.isActive || pending.repository.activeProjectionId !== firstApproval.projectionId) {
    throw new Error("A pending Wiki rerun replaced the approved knowledge version before review");
  }
  const knowledgeDuringPending = await request<Awaited<ReturnType<typeof getCandidateActiveRepositoryKnowledge>>>(`/api/knowledge/repositories/${repositoryId}`);
  if (knowledgeDuringPending.payload.data?.dossier.id !== review.dossier.id) throw new Error("Pending Repository Wiki replaced Candidate Knowledge before approval");
  const secondApproval = await approveCandidateRepositoryDossier({ pool, artifactRoot, ownerId, repositoryId, dossierId: pending.dossier.id, requestId: "wiki-smoke-approve-v2" });
  const projectionStates = await pool.query<{ oldState: string; currentState: string }>(
    `SELECT old.state AS "oldState",current.state AS "currentState" FROM repository_dossier_projections old,repository_dossier_projections current WHERE old.id=$1 AND current.id=$2`,
    [firstApproval.projectionId, secondApproval.projectionId],
  );
  if (secondCompletion.generatedVersion !== 2 || projectionStates.rows[0]?.oldState !== "superseded" || projectionStates.rows[0]?.currentState !== "approved") {
    throw new Error("Repository Wiki approval did not supersede the previous knowledge projection");
  }

  const provenanceClient = await pool.connect();
  try {
    await provenanceClient.query("BEGIN");
    const outdated = await markRepositoryDossiersOutdated(provenanceClient, { imageDigest: "sha256:new-runtime", skillHash: "1".repeat(64), promptVersion: "repository-wiki-v2", profileFingerprint: "2".repeat(64) });
    const activeAfterOutdated = await getCandidateRepositoryDossier(provenanceClient, ownerId, repositoryId);
    if (outdated.markedOutdated < 1 || !activeAfterOutdated.dossier?.isActive || activeAfterOutdated.dossier.outdatedReason !== "runtime_provenance_changed") {
      throw new Error("Runtime provenance drift did not preserve and mark the active Repository Wiki");
    }
    await provenanceClient.query("ROLLBACK");
  } catch (error) {
    await provenanceClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    provenanceClient.release();
  }

  const invalid = await createRevisionAndRun(2, first.revisionId);
  const invalidOutput = structuredClone(wikiOutput);
  invalidOutput.citations[0]!.contentHash = "f".repeat(64);
  let rejectedCode: string | null = null;
  try {
    await completeRepositoryAnalysisRun({
      pool, artifactRoot, runId: invalid.runId, leaseOwner: "wiki-smoke-runner", output: invalidOutput, wikiFiles,
      actualModel: "deepseek-v4-pro-smoke", usage: {}, cleanupCompletedAt: new Date(),
    });
  } catch (error) {
    rejectedCode = error instanceof Error && "code" in error ? String(error.code) : null;
  }
  if (rejectedCode !== "DOSSIER_CITATION_HASH_INVALID") throw new Error("Invalid Repository Wiki Citation was not rejected before persistence");

  const lowered = await request<{ visibility: string }>(`/api/repositories/${repositoryId}`, { method: "PATCH", body: JSON.stringify({ visibility: "private" }) });
  if (lowered.response.status !== 200 || lowered.payload.data?.visibility !== "private") throw new Error("Repository Wiki smoke visibility lowering failed");
  const hiddenKnowledge = await request<{ items: KnowledgeListItem[]; total: number }>("/api/knowledge?type=repository&status=active");
  const hiddenDetail = await request<unknown>(`/api/knowledge/repositories/${repositoryId}`);
  const hiddenEvidence = await retrieveUnifiedEvidence(pool, ownerId, "candidate_preview", { query: "approved answer", limit: 8 });
  if (hiddenKnowledge.payload.data?.items.some((item) => item.id === repositoryId) || hiddenDetail.response.status !== 404 || hiddenDetail.payload.error?.code !== "REPOSITORY_KNOWLEDGE_NOT_FOUND" || hiddenEvidence.some((item) => "repositoryWikiPageId" in item && item.repositoryId === repositoryId)) {
    throw new Error("Private Repository Wiki remained available to Knowledge or Agent retrieval");
  }

  console.info(JSON.stringify({
    event: "smoke.repository-wiki.completed",
    generatedVersion: completed.generatedVersion,
    pageCount: stored.rows[0].pageCount,
    citationCount: stored.rows[0].citationCount,
    sandboxMarkdownPersisted: true,
    idempotentReplay: true,
    projectionEdited: true,
    approvalActivatedKnowledge: true,
    unifiedKnowledgeListed: true,
    unifiedKnowledgePaginated: true,
    unifiedKnowledgeSearched: true,
    activeKnowledgeDetail: true,
    unifiedKnowledgeRetrieved: true,
    publicKnowledgeRetrieved: true,
    pendingRerunPreservedApprovedKnowledge: true,
    previousProjectionSuperseded: true,
    activeWikiMarkedOutdated: true,
    invalidCitationRejected: true,
    visibilityLoweringImmediate: true,
  }));
} finally {
  if (!keepFixture) {
    await pool.query("DELETE FROM repository_message_citations WHERE owner_id=$1", [ownerId]).catch(() => undefined);
    await pool.query("DELETE FROM repository_dossiers WHERE owner_id=$1", [ownerId]).catch(() => undefined);
    await pool.query("DELETE FROM users WHERE id=$1", [ownerId]).catch(() => undefined);
    if (artifactKey) await pool.query("DELETE FROM repository_artifacts WHERE content_key=$1", [artifactKey]).catch(() => undefined);
    if (artifactKey && artifactStoragePath) await artifactStore.remove(artifactKey, artifactStoragePath).catch(() => undefined);
  }
  await pool.end();
  if (!keepFixture && temporaryArtifactRoot) await rm(artifactRoot, { recursive: true, force: true });
}
