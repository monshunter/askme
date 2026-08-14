import { createHash, randomUUID } from "node:crypto";

import JSZip from "jszip";
import { Pool } from "pg";

import { getRuntimeConfig, requireDatabaseUrl } from "../src/server/config";
import { RerankClient } from "../src/server/ai/retrieval-providers";
import { FileSystemRepositoryArtifactStore } from "../src/server/repositories/artifact-store";
import { loadRepositorySourcePreview } from "../src/server/repositories/source-preview";
import { activateIndexVersion, markIndexVersionReady, startIndexRebuild } from "../src/server/rag/index-coordinator";
import { retrieveHybridEvidence } from "../src/server/rag/hybrid-retriever";
import { runBoundedRetrieval } from "../src/server/rag/evidence-orchestrator";
import { analyzeDeterministicQuery } from "../src/server/rag/query-planner";
import { persistRagAnswerCitations, validateRagEvidence } from "../src/server/rag/rag-answer";
import { persistRetrievalTrace } from "../src/server/rag/retrieval-trace";
import { enqueueRepositoryDocumentSources, revokeRepositoryDocumentSources } from "../src/server/rag/repository-document-index";
import { claimNextRagSource, processRagSourceLease } from "../src/server/rag/source-indexer";

function minimalPdf(text: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length + 33} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(source)); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return source;
}

async function main() {
  const configured = getRuntimeConfig();
  const artifactRoot = configured.repositoryArtifactRoot;
  const artifactStore = new FileSystemRepositoryArtifactStore(artifactRoot);
  const config = { ...configured, repositoryArtifactRoot: artifactRoot };
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 4 });
  const ownerId = randomUUID();
  let artifactContentKey: string | null = null;
  let artifactStoragePath: string | null = null;
  let artifactRecordCreated = false;
  try {
    const repositoryId = randomUUID();
    const revisionId = randomUUID();
    const commitSha = "a".repeat(40);
    const zip = new JSZip();
    zip.file("repository-root/README.md", "# Atlas\n\nAtlas uses a permission-first Hybrid RAG pipeline.\n");
    zip.file("repository-root/docs/architecture.pdf", minimalPdf("Atlas Repository PDF Evidence"));
    zip.file("repository-root/src/index.ts", "export const sourceCodeMustNotBeEmbedded = true;\n");
    const archive = new Uint8Array(await zip.generateAsync({ type: "uint8array", platform: "UNIX" }));
    const stored = await artifactStore.store({
      ownerId,
      canonicalUrl: "https://github.com/example/atlas",
      commitSha,
      archive,
      archiveChecksum: createHash("sha256").update(archive).digest("hex"),
      excludePatterns: [],
    });
    artifactContentKey = stored.contentKey;
    artifactStoragePath = stored.storagePath;
    await pool.query("INSERT INTO users(id,email,password_hash,role,display_name) VALUES ($1,$2,'smoke-only','candidate','RAG Smoke Candidate')", [ownerId, `rag-smoke-${ownerId}@example.test`]);
    const artifactInserted = await pool.query(
      `INSERT INTO repository_artifacts(content_key,checksum,manifest_checksum,storage_path,compressed_bytes,extracted_bytes,file_count,reference_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1)
       ON CONFLICT (content_key) DO NOTHING RETURNING content_key`,
      [stored.contentKey, stored.checksum, stored.manifestChecksum, stored.storagePath, stored.compressedBytes, stored.extractedBytes, stored.fileCount],
    );
    if (artifactInserted.rowCount !== 1) throw new Error("RAG_INDEX_SMOKE_ARTIFACT_CONFLICT");
    artifactRecordCreated = true;
    await pool.query(
      `INSERT INTO repositories(id,owner_id,provider,canonical_url,display_name,visibility) VALUES ($1,$2,'github',$3,'example/atlas','public_preview')`,
      [repositoryId, ownerId, "https://github.com/example/atlas"],
    );
    await pool.query(
      `INSERT INTO repository_revisions(id,repository_id,owner_id,requested_ref,commit_sha,archive_checksum,artifact_key,filter_version,filter_fingerprint,exclude_patterns,archive_bytes,extracted_bytes,file_count,state,stored_at)
       VALUES ($1,$2,$3,'main',$4,$5,$6,2,$7,'[]'::jsonb,$8,$9,$10,'stored',now())`,
      [revisionId, repositoryId, ownerId, commitSha, createHash("sha256").update(archive).digest("hex"), stored.contentKey, stored.filterFingerprint, archive.byteLength, stored.extractedBytes, stored.fileCount],
    );
    await pool.query("UPDATE repositories SET active_revision_id=$2 WHERE id=$1", [repositoryId, revisionId]);

    const rebuild = await startIndexRebuild(pool, config);
    const queued = await enqueueRepositoryDocumentSources(pool, config, ownerId, repositoryId);
    let processed = 0;
    const smokeDeadline = Date.now() + 60_000;
    while (true) {
      const lease = await claimNextRagSource(pool, "rag-index-smoke", 300_000);
      if (lease) {
        await processRagSourceLease(pool, lease, config);
        processed += 1;
        continue;
      }
      const pending = await pool.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM rag_source_versions
         WHERE owner_id=$1 AND metadata->>'repositoryId'=$2 AND state IN ('queued','processing')`,
        [ownerId, repositoryId],
      );
      if (pending.rows[0]?.count === 0) break;
      if (Date.now() >= smokeDeadline) throw new Error("RAG_INDEX_SMOKE_TIMEOUT");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const beforeActivation = await pool.query<{ state: string }>("SELECT state FROM rag_index_versions WHERE id=$1", [rebuild.indexVersionId]);
    if (beforeActivation.rows[0]?.state !== "active") {
      await markIndexVersionReady(pool, rebuild.indexVersionId);
      await activateIndexVersion(pool, rebuild.indexVersionId);
    }
    const verified = await pool.query<{
      indexState: string; repositoryState: string; sourceCount: number; markdownCount: number; pdfCount: number; childCount: number; dimensions: number;
    }>(
      `SELECT version.state AS "indexState",repository.rag_index_state AS "repositoryState",
              count(DISTINCT source.id)::integer AS "sourceCount",
              count(DISTINCT source.id) FILTER (WHERE source.source_kind='repository_markdown')::integer AS "markdownCount",
              count(DISTINCT source.id) FILTER (WHERE source.source_kind='repository_pdf')::integer AS "pdfCount",
              count(DISTINCT child.id)::integer AS "childCount",min(vector_dims(child.embedding))::integer AS dimensions
       FROM rag_index_versions version
       JOIN rag_source_versions source ON source.index_version_id=version.id
       JOIN rag_child_chunks child ON child.source_version_id=source.id
       JOIN repositories repository ON repository.id=$2
       WHERE version.id=$1 AND source.metadata->>'repositoryId'=$2::text
       GROUP BY version.state,repository.rag_index_state`,
      [rebuild.indexVersionId, repositoryId],
    );
    const evidence = verified.rows[0];
    if (!evidence || evidence.indexState !== "active" || evidence.repositoryState !== "ready" || evidence.sourceCount !== 2 || evidence.markdownCount !== 1 || evidence.pdfCount !== 1 || evidence.dimensions !== 1_024) {
      throw new Error("Repository document index evidence did not meet the V2 contract");
    }
    const retrieval = await retrieveHybridEvidence(pool, ownerId, "candidate_preview", analyzeDeterministicQuery("Atlas permission-first Hybrid RAG pipeline"), config);
    if (retrieval.routeCounts.exact < 1 || retrieval.routeCounts.lexical < 1 || retrieval.routeCounts.vector < 1
      || !retrieval.candidates.some((candidate) => candidate.sourceKind === "repository_markdown" && candidate.path === "README.md")) {
      throw new Error("Hybrid retrieval did not recall the authorized Repository Markdown evidence");
    }
    const plan = analyzeDeterministicQuery("Atlas permission-first Hybrid RAG pipeline");
    const bounded = await runBoundedRetrieval({
      initialPlan: plan,
      config,
      retrieve: (roundPlan) => retrieveHybridEvidence(pool, ownerId, "candidate_preview", roundPlan, config),
      rerankClient: new RerankClient(config.rerank),
    });
    if (bounded.coverage !== "full" || bounded.roundCount > 2) throw new Error("Bounded retrieval did not produce full coverage within two rounds");
    const cited = bounded.candidates.find((candidate) => candidate.sourceKind === "repository_markdown");
    if (!cited) throw new Error("The bounded Evidence Pack did not retain Repository Markdown");
    await validateRagEvidence(pool, ownerId, "candidate_preview", [cited]);
    const conversationId = randomUUID();
    const messageId = randomUUID();
    await pool.query("INSERT INTO conversations(id,owner_id,mode) VALUES ($1,$2,'preview')", [conversationId, ownerId]);
    await pool.query("INSERT INTO messages(id,conversation_id,owner_id,role,status,content) VALUES ($1,$2,$3,'assistant','completed','Verified RAG smoke answer')", [messageId, conversationId, ownerId]);
    await persistRagAnswerCitations(pool, ownerId, messageId, [cited]);
    await persistRetrievalTrace(pool, { ownerId, conversationId, messageId, callerMode: "candidate_preview", config, result: bounded, latencyMs: 1 });
    const persisted = await pool.query<{ count: number }>("SELECT count(*)::integer AS count FROM rag_message_citations WHERE message_id=$1 AND owner_id=$2", [messageId, ownerId]);
    const trace = await pool.query<{ count: number }>("SELECT count(*)::integer AS count FROM rag_query_traces WHERE message_id=$1 AND owner_id=$2", [messageId, ownerId]);
    if (persisted.rows[0]?.count !== 1 || trace.rows[0]?.count !== 1) throw new Error("The V2 Citation or Retrieval Trace identity was not persisted");
    if (!cited.repositoryId || !cited.revisionId || !cited.path || !cited.sourceRange.lineStart || !cited.sourceRange.lineEnd) throw new Error("The Repository Citation location is incomplete");
    const sourcePreview = await loadRepositorySourcePreview({
      pool, artifactRoot, repositoryId: cited.repositoryId,
      citation: { messageId, revisionId: cited.revisionId, path: cited.path, lineStart: cited.sourceRange.lineStart, lineEnd: cited.sourceRange.lineEnd },
      authorization: { mode: "candidate", ownerId },
    });
    if (!sourcePreview.content.includes("permission-first Hybrid RAG")) throw new Error("The V2 Repository Citation did not reopen the immutable source range");
    await pool.query("UPDATE repositories SET visibility='private' WHERE id=$1 AND owner_id=$2", [repositoryId, ownerId]);
    await revokeRepositoryDocumentSources(pool, ownerId, repositoryId);
    let revoked = false;
    try { await validateRagEvidence(pool, ownerId, "candidate_preview", [cited]); } catch { revoked = true; }
    const afterRevocation = await retrieveHybridEvidence(pool, ownerId, "candidate_preview", plan, config);
    if (!revoked || afterRevocation.candidates.length !== 0) throw new Error("Repository authorization revocation did not remove the V2 Evidence");
    console.info(JSON.stringify({ event: "rag.index-foundation.smoke-passed", indexVersionId: rebuild.indexVersionId, queued, processed, ...evidence, routeCounts: retrieval.routeCounts, retrievalDegradations: bounded.degradations, coverage: bounded.coverage, roundCount: bounded.roundCount, persistedCitationCount: persisted.rows[0].count, persistedTraceCount: trace.rows[0].count, revocationEnforced: revoked }));
  } finally {
    try {
      await pool.query("DELETE FROM users WHERE id=$1", [ownerId]);
      if (artifactContentKey && artifactRecordCreated) {
        await pool.query(
          "DELETE FROM repository_artifacts WHERE content_key=$1 AND NOT EXISTS (SELECT 1 FROM repository_revisions WHERE artifact_key=$1)",
          [artifactContentKey],
        );
      }
    } finally {
      await pool.end();
      if (artifactContentKey && artifactStoragePath && artifactRecordCreated) {
        await artifactStore.remove(artifactContentKey, artifactStoragePath);
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    event: "rag.index-foundation.smoke-failed",
    errorCode: error instanceof Error ? error.name : "UNKNOWN",
    errorMessage: error instanceof Error ? error.message : "Unknown smoke failure",
  }));
  process.exitCode = 1;
});
