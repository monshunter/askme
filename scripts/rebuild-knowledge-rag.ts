import os from "node:os";

import { Pool } from "pg";

import { getRuntimeConfig, requireDatabaseUrl } from "../src/server/config";
import { AppError, toAppError } from "../src/server/errors";
import { failIngestionJob } from "../src/server/jobs/fail-ingestion";
import { claimNextIngestionJob } from "../src/server/jobs/ingestion-jobs";
import { processIngestionLease } from "../src/server/jobs/process-ingestion";
import { activateIndexVersion, markIndexVersionReady, startIndexRebuild } from "../src/server/rag/index-coordinator";
import { enqueueRepositoryDocumentSources } from "../src/server/rag/repository-document-index";
import { claimNextRagSource, failRagSourceLease, processRagSourceLease } from "../src/server/rag/source-indexer";

const settleDeadlineMs = 10 * 60_000;

function wait(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function snapshot(pool: Pool) {
  const result = await pool.query<{
    indexedMaterials: number;
    knowledgeItems: number;
    entities: number;
    activeSources: number;
    activeChildren: number;
  }>(
    `SELECT
       (SELECT count(*)::integer FROM materials WHERE status='indexed') AS "indexedMaterials",
       (SELECT count(*)::integer FROM knowledge_items WHERE status='active') AS "knowledgeItems",
       (SELECT count(*)::integer FROM knowledge_items knowledge CROSS JOIN LATERAL jsonb_array_elements(knowledge.entities)) AS entities,
       (SELECT count(*)::integer FROM rag_source_versions WHERE state='active') AS "activeSources",
       (SELECT count(*)::integer FROM rag_child_chunks child JOIN rag_index_versions version ON version.id=child.index_version_id WHERE version.state='active') AS "activeChildren"`,
  );
  return result.rows[0]!;
}

async function requeueIndexedMaterials(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const targets = await client.query<{ id: string }>("SELECT id FROM materials WHERE status='indexed' ORDER BY id FOR UPDATE");
    const materialIds = targets.rows.map((row) => row.id);
    if (materialIds.length > 0) {
      await client.query(
        `UPDATE ingestion_jobs SET status='queued',attempts=0,lease_owner=NULL,lease_expires_at=NULL,next_run_at=now(),
                last_error_code=NULL,last_error_message=NULL,completed_at=NULL,updated_at=now()
         WHERE material_id=ANY($1::uuid[])`,
        [materialIds],
      );
      await client.query(
        `UPDATE materials SET status='queued',error_code=NULL,error_message=NULL,indexed_at=NULL,updated_at=now()
         WHERE id=ANY($1::uuid[])`,
        [materialIds],
      );
    }
    await client.query("COMMIT");
    return materialIds;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function rebuildKnowledge(pool: Pool, materialIds: string[], workerId: string, config: ReturnType<typeof getRuntimeConfig>) {
  const deadline = Date.now() + settleDeadlineMs;
  let processed = 0;
  while (true) {
    const lease = await claimNextIngestionJob(pool, workerId, 300_000, materialIds);
    if (lease) {
      try {
        await processIngestionLease(pool, lease, config);
        processed += 1;
      } catch (error) {
        await failIngestionJob(pool, lease, toAppError(error), config.ai.profiles.rag.model);
      }
      continue;
    }
    const state = await pool.query<{ pending: number; failed: number }>(
      `SELECT count(*) FILTER (WHERE status IN ('queued','processing'))::integer AS pending,
              count(*) FILTER (WHERE status='failed')::integer AS failed
       FROM ingestion_jobs WHERE material_id=ANY($1::uuid[])`,
      [materialIds],
    );
    if ((state.rows[0]?.failed ?? 0) > 0) throw new AppError("KNOWLEDGE_REBUILD_FAILED", "One or more Material knowledge rebuilds failed.", 409);
    if ((state.rows[0]?.pending ?? 0) === 0) return processed;
    if (Date.now() >= deadline) throw new AppError("KNOWLEDGE_REBUILD_TIMEOUT", "The Material knowledge rebuild did not settle before its deadline.", 504);
    await wait(250);
  }
}

async function indexProgress(pool: Pool, indexVersionId: string) {
  const result = await pool.query<{ expected: number; complete: number; pending: number; failed: number }>(
    `SELECT version.expected_source_count AS expected,
            count(source.id) FILTER (WHERE source.state IN ('ready','ready_with_warnings','active'))::integer AS complete,
            count(source.id) FILTER (WHERE source.state IN ('queued','processing'))::integer AS pending,
            count(source.id) FILTER (WHERE source.state='failed')::integer AS failed
     FROM rag_index_versions version LEFT JOIN rag_source_versions source ON source.index_version_id=version.id
     WHERE version.id=$1 GROUP BY version.id`,
    [indexVersionId],
  );
  if (!result.rows[0]) throw new AppError("RAG_INDEX_NOT_FOUND", "The RAG index version does not exist.", 404);
  return result.rows[0];
}

async function rebuildRag(pool: Pool, workerId: string, config: ReturnType<typeof getRuntimeConfig>) {
  const rebuild = await startIndexRebuild(pool, config);
  const repositories = await pool.query<{ id: string; ownerId: string }>(
    `SELECT id,owner_id AS "ownerId" FROM repositories
     WHERE active_revision_id IS NOT NULL AND disabled_at IS NULL ORDER BY owner_id,id`,
  );
  for (const repository of repositories.rows) await enqueueRepositoryDocumentSources(pool, config, repository.ownerId, repository.id);
  const deadline = Date.now() + settleDeadlineMs;
  let indexed = 0;
  while (true) {
    const lease = await claimNextRagSource(pool, workerId, 300_000);
    if (lease) {
      try {
        await processRagSourceLease(pool, lease, config);
        indexed += 1;
      } catch (error) {
        await failRagSourceLease(pool, lease, toAppError(error));
      }
      continue;
    }
    const progress = await indexProgress(pool, rebuild.indexVersionId);
    if (progress.failed > 0) throw new AppError("RAG_INDEX_REBUILD_FAILED", "One or more RAG sources failed to rebuild.", 409);
    if (progress.pending === 0) {
      const ready = progress.expected === progress.complete && await markIndexVersionReady(pool, rebuild.indexVersionId);
      if (!ready) throw new AppError("RAG_INDEX_NOT_READY", "The RAG index version is incomplete.", 409);
      return { ...rebuild, indexed, progress };
    }
    if (Date.now() >= deadline) throw new AppError("RAG_INDEX_REBUILD_TIMEOUT", "The RAG index rebuild did not settle before its deadline.", 504);
    await wait(250);
  }
}

async function main() {
  const execute = process.argv.includes("--execute");
  const activate = process.argv.includes("--activate");
  if (activate && !execute) throw new AppError("RAG_REBUILD_EXECUTE_REQUIRED", "--activate requires --execute.", 422);
  const config = getRuntimeConfig();
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: Math.max(3, config.embedding.concurrency + 1) });
  const before = await snapshot(pool);
  try {
    if (!execute) {
      console.info(JSON.stringify({ event: "knowledge-rag.rebuild.planned", execute: false, activate: false, before }));
      return;
    }
    const workerId = `${os.hostname()}:knowledge-rag-rebuild:${process.pid}`;
    const materialIds = await requeueIndexedMaterials(pool);
    const organized = await rebuildKnowledge(pool, materialIds, workerId, config);
    const rag = await rebuildRag(pool, workerId, config);
    if (activate) await activateIndexVersion(pool, rag.indexVersionId);
    const after = await snapshot(pool);
    console.info(JSON.stringify({
      event: "knowledge-rag.rebuild.completed",
      execute: true,
      activate,
      materialCount: materialIds.length,
      organized,
      indexVersionId: rag.indexVersionId,
      indexedSources: rag.indexed,
      before,
      after,
    }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const safe = toAppError(error);
  console.error(JSON.stringify({ event: "knowledge-rag.rebuild.failed", errorCode: safe.code }));
  process.exitCode = 1;
});
