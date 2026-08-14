import os from "node:os";

import { Pool } from "pg";

import { getRuntimeConfig, requireDatabaseUrl } from "../src/server/config";
import { AppError, toAppError } from "../src/server/errors";
import { activateIndexVersion, markIndexVersionReady, startIndexRebuild } from "../src/server/rag/index-coordinator";
import { enqueueRepositoryDocumentSources } from "../src/server/rag/repository-document-index";
import { claimNextRagSource, failRagSourceLease, processRagSourceLease } from "../src/server/rag/source-indexer";

const rebuildDeadlineMs = 5 * 60_000;

async function readIndexProgress(pool: Pool, indexVersionId: string) {
  const result = await pool.query<{ expected: number; complete: number; pending: number; failed: number }>(
    `SELECT version.expected_source_count AS expected,
            count(source.id) FILTER (WHERE source.state IN ('ready','ready_with_warnings','active'))::integer AS complete,
            count(source.id) FILTER (WHERE source.state IN ('queued','processing'))::integer AS pending,
            count(source.id) FILTER (WHERE source.state='failed')::integer AS failed
     FROM rag_index_versions version
     LEFT JOIN rag_source_versions source ON source.index_version_id=version.id
     WHERE version.id=$1 GROUP BY version.id`,
    [indexVersionId],
  );
  const progress = result.rows[0];
  if (!progress) throw new AppError("RAG_INDEX_NOT_FOUND", "The RAG index version does not exist.", 404);
  return progress;
}

async function main() {
  const config = getRuntimeConfig();
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: Math.max(2, config.embedding.concurrency + 1) });
  const workerId = `${os.hostname()}:rag-rebuild:${process.pid}`;
  try {
    const rebuild = await startIndexRebuild(pool, config);
    const repositories = await pool.query<{ id: string; ownerId: string }>(
      `SELECT id,owner_id AS "ownerId" FROM repositories
       WHERE active_revision_id IS NOT NULL AND disabled_at IS NULL ORDER BY owner_id,id`,
    );
    for (const repository of repositories.rows) {
      await enqueueRepositoryDocumentSources(pool, config, repository.ownerId, repository.id);
    }
    let indexed = 0;
    let failed = 0;
    const deadline = Date.now() + rebuildDeadlineMs;
    let progress = await readIndexProgress(pool, rebuild.indexVersionId);
    while (true) {
      const lease = await claimNextRagSource(pool, workerId, 300_000);
      if (lease) {
        try {
          await processRagSourceLease(pool, lease, config);
          indexed += 1;
        } catch (error) {
          const safe = toAppError(error);
          await failRagSourceLease(pool, lease, safe);
          failed += 1;
          console.warn(JSON.stringify({ event: "rag.rebuild.source-failed", sourceVersionId: lease.sourceVersionId, sourceKind: lease.sourceKind, errorCode: safe.code }));
        }
        continue;
      }
      progress = await readIndexProgress(pool, rebuild.indexVersionId);
      if (progress.pending === 0) break;
      if (Date.now() >= deadline) throw new AppError("RAG_INDEX_REBUILD_TIMEOUT", "The RAG index rebuild did not settle before its deadline.", 504);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    progress = await readIndexProgress(pool, rebuild.indexVersionId);
    failed = Math.max(failed, progress.failed);
    const ready = progress.expected === progress.complete && progress.pending === 0 && progress.failed === 0
      && await markIndexVersionReady(pool, rebuild.indexVersionId);
    if (!ready) throw new AppError("RAG_INDEX_NOT_READY", "The RAG index version is incomplete.", 409);
    if (process.argv.includes("--activate")) {
      await activateIndexVersion(pool, rebuild.indexVersionId);
    }
    console.info(JSON.stringify({ event: "rag.rebuild.completed", indexVersionId: rebuild.indexVersionId, expectedSourceCount: progress.expected, indexed, failed, ready, activated: process.argv.includes("--activate") }));
    if (failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const safe = toAppError(error);
  console.error(JSON.stringify({ event: "rag.rebuild.failed", errorCode: safe.code }));
  process.exitCode = 1;
});
