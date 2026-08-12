import { getRuntimeConfig } from "@/server/config";
import { getPool } from "@/server/db/client";

import { deriveDashboardState, type DashboardFacts } from "./dashboard-state";

type DashboardRow = Omit<DashboardFacts, "publicationStatus" | "aiConfigured" | "workerFresh"> & {
  publicationStatus: DashboardFacts["publicationStatus"];
  workerFresh: boolean;
  workerLastSeenAt: Date | null;
};

export async function getCandidateDashboard(ownerId: string) {
  const pool = getPool();
  const [factsResult, recentResult] = await Promise.all([
    pool.query<DashboardRow>(
      `SELECT
         (SELECT count(*)::int FROM materials WHERE owner_id=$1) AS "materialTotal",
         (SELECT count(*)::int FROM materials WHERE owner_id=$1 AND status='queued') AS "queuedCount",
         (SELECT count(*)::int FROM materials WHERE owner_id=$1 AND status='processing') AS "processingCount",
         (SELECT count(*)::int FROM materials WHERE owner_id=$1 AND status='indexed') AS "indexedCount",
         (SELECT count(*)::int FROM materials WHERE owner_id=$1 AND status='failed') AS "failedCount",
         (SELECT count(*)::int FROM knowledge_items WHERE owner_id=$1 AND status='active') AS "knowledgeTotal",
         (SELECT count(DISTINCT ki.id)::int
            FROM knowledge_items ki
            JOIN knowledge_sources ks ON ks.knowledge_item_id=ki.id AND ks.owner_id=ki.owner_id
            JOIN materials m ON m.id=ks.material_id AND m.owner_id=ks.owner_id
           WHERE ki.owner_id=$1 AND ki.status='active' AND m.visibility IN ('citation_allowed','public_preview')) AS "citationReadyCount",
         (SELECT status FROM publications WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 1) AS "publicationStatus",
         coalesce((SELECT last_seen_at > now()-interval '30 seconds' FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 1),false) AS "workerFresh",
         (SELECT last_seen_at FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 1) AS "workerLastSeenAt"`,
      [ownerId],
    ),
    pool.query(
      `SELECT id,title,kind,mime_type AS "mimeType",external_url AS "externalUrl",status,visibility,error_code AS "errorCode",error_message AS "errorMessage",created_at AS "createdAt",updated_at AS "updatedAt"
       FROM materials WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 5`,
      [ownerId],
    ),
  ]);
  const row = factsResult.rows[0]!;
  const facts: DashboardFacts = { ...row, aiConfigured: Boolean(getRuntimeConfig().deepseek.apiKey) };
  return {
    metrics: {
      sourceMaterials: facts.materialTotal,
      indexedMaterials: facts.indexedCount,
      knowledgeItems: facts.knowledgeTotal,
      citationReadyItems: facts.citationReadyCount,
      processing: { queued: facts.queuedCount, processing: facts.processingCount, indexed: facts.indexedCount, failed: facts.failedCount },
    },
    ...deriveDashboardState(facts),
    ai: { configured: facts.aiConfigured, model: getRuntimeConfig().deepseek.model },
    worker: { status: facts.workerFresh ? "healthy" : "stale", lastSeenAt: row.workerLastSeenAt },
    recentMaterials: recentResult.rows,
  };
}
