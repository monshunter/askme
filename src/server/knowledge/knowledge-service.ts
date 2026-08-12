import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";

import type { KnowledgeUpdate } from "./knowledge-input";
import type { KnowledgeListQuery } from "./knowledge-query";

type KnowledgeListRow = {
  id: string;
  type: string;
  status: string;
  title: string;
  summary: string;
  highlights: string[];
  confidence: number;
  sourceCount: number;
  chunkCount: number;
  sourceTitles: string[];
  sourceVisibilities: string[];
  citationReady: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function orderBy(sort: KnowledgeListQuery["sort"]) {
  if (sort === "confidence") return "ki.confidence DESC, ki.updated_at DESC, ki.id DESC";
  if (sort === "title") return "lower(ki.title) ASC, ki.id ASC";
  return "ki.updated_at DESC, ki.id DESC";
}

export async function listKnowledge(ownerId: string, query: KnowledgeListQuery) {
  const values: unknown[] = [ownerId, query.status];
  const filters = ["ki.owner_id=$1", "ki.status=$2"];
  if (query.type) {
    values.push(query.type);
    filters.push(`ki.type=$${values.length}`);
  }
  if (query.search) {
    values.push(query.search);
    const position = values.length;
    filters.push(`(
      ki.search_vector @@ websearch_to_tsquery('simple',$${position})
      OR ki.title ILIKE '%' || $${position} || '%'
      OR EXISTS (
        SELECT 1 FROM knowledge_evidence search_ke
        JOIN chunks search_c ON search_c.id=search_ke.chunk_id AND search_c.owner_id=search_ke.owner_id
        WHERE search_ke.knowledge_item_id=ki.id AND search_ke.owner_id=$1
          AND search_c.search_vector @@ websearch_to_tsquery('simple',$${position})
      )
      OR EXISTS (
        SELECT 1 FROM knowledge_sources search_ks
        JOIN materials search_m ON search_m.id=search_ks.material_id AND search_m.owner_id=search_ks.owner_id
        WHERE search_ks.knowledge_item_id=ki.id AND search_ks.owner_id=$1
          AND (search_m.title ILIKE '%' || $${position} || '%' OR coalesce(search_m.original_name,'') ILIKE '%' || $${position} || '%' OR coalesce(search_m.external_url,'') ILIKE '%' || $${position} || '%')
      )
    )`);
  }
  if (query.citationReady !== undefined) {
    values.push(query.citationReady);
    filters.push(`EXISTS (
      SELECT 1 FROM knowledge_sources ready_ks
      JOIN materials ready_m ON ready_m.id=ready_ks.material_id AND ready_m.owner_id=ready_ks.owner_id
      WHERE ready_ks.knowledge_item_id=ki.id AND ready_ks.owner_id=$1 AND ready_m.visibility IN ('citation_allowed','public_preview')
    )=$${values.length}`);
  }
  const where = filters.join(" AND ");
  values.push(query.pageSize, (query.page - 1) * query.pageSize);
  const limitPosition = values.length - 1;
  const offsetPosition = values.length;
  const pool = getPool();
  const [itemsResult, totalResult, countsResult] = await Promise.all([
    pool.query<KnowledgeListRow>(
      `SELECT ki.id,ki.type,ki.status,ki.title,ki.summary,ki.highlights,ki.confidence,
              count(DISTINCT ks.material_id)::int AS "sourceCount",
              count(DISTINCT c.id)::int AS "chunkCount",
              coalesce(jsonb_agg(DISTINCT m.title) FILTER (WHERE m.id IS NOT NULL),'[]'::jsonb) AS "sourceTitles",
              coalesce(jsonb_agg(DISTINCT m.visibility) FILTER (WHERE m.id IS NOT NULL),'[]'::jsonb) AS "sourceVisibilities",
              coalesce(bool_or(m.visibility IN ('citation_allowed','public_preview')),false) AND count(DISTINCT c.id)>0 AS "citationReady",
              ki.created_at AS "createdAt",ki.updated_at AS "updatedAt"
       FROM knowledge_items ki
       LEFT JOIN knowledge_sources ks ON ks.knowledge_item_id=ki.id AND ks.owner_id=ki.owner_id
       LEFT JOIN materials m ON m.id=ks.material_id AND m.owner_id=ks.owner_id
       LEFT JOIN knowledge_evidence ke ON ke.knowledge_item_id=ki.id AND ke.owner_id=ki.owner_id
       LEFT JOIN chunks c ON c.id=ke.chunk_id AND c.owner_id=ke.owner_id
       WHERE ${where}
       GROUP BY ki.id
       ORDER BY ${orderBy(query.sort)}
       LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
      values,
    ),
    pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM knowledge_items ki WHERE ${where}`, values.slice(0, limitPosition - 1)),
    pool.query<{ type: string; count: number }>(
      `SELECT type,count(*)::int AS count FROM knowledge_items WHERE owner_id=$1 AND status=$2 GROUP BY type ORDER BY type`,
      [ownerId, query.status],
    ),
  ]);
  const total = totalResult.rows[0]?.total ?? 0;
  const counts = Object.fromEntries(countsResult.rows.map((row) => [row.type, row.count]));
  return { items: itemsResult.rows, counts: { all: Object.values(counts).reduce((sum, value) => sum + value, 0), ...counts }, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
}

export async function getKnowledgeDetail(ownerId: string, knowledgeItemId: string) {
  const pool = getPool();
  const item = await pool.query<KnowledgeListRow>(
    `SELECT ki.id,ki.type,ki.status,ki.title,ki.summary,ki.highlights,ki.confidence,
            count(DISTINCT ks.material_id)::int AS "sourceCount",count(DISTINCT c.id)::int AS "chunkCount",
            coalesce(jsonb_agg(DISTINCT m.title) FILTER (WHERE m.id IS NOT NULL),'[]'::jsonb) AS "sourceTitles",
            coalesce(jsonb_agg(DISTINCT m.visibility) FILTER (WHERE m.id IS NOT NULL),'[]'::jsonb) AS "sourceVisibilities",
            coalesce(bool_or(m.visibility IN ('citation_allowed','public_preview')),false) AND count(DISTINCT c.id)>0 AS "citationReady",
            ki.created_at AS "createdAt",ki.updated_at AS "updatedAt"
     FROM knowledge_items ki
     LEFT JOIN knowledge_sources ks ON ks.knowledge_item_id=ki.id AND ks.owner_id=ki.owner_id
     LEFT JOIN materials m ON m.id=ks.material_id AND m.owner_id=ks.owner_id
     LEFT JOIN knowledge_evidence ke ON ke.knowledge_item_id=ki.id AND ke.owner_id=ki.owner_id
     LEFT JOIN chunks c ON c.id=ke.chunk_id AND c.owner_id=ke.owner_id
     WHERE ki.id=$1 AND ki.owner_id=$2 GROUP BY ki.id`,
    [knowledgeItemId, ownerId],
  );
  if (!item.rows[0]) throw new AppError("KNOWLEDGE_NOT_FOUND", "The knowledge item was not found.", 404);
  const [sources, evidence] = await Promise.all([
    pool.query(
      `SELECT m.id,m.title,m.kind,m.mime_type AS "mimeType",m.status,m.visibility,m.external_url AS "externalUrl",m.summary,m.updated_at AS "updatedAt",
              count(c.id)::int AS "chunkCount"
       FROM knowledge_sources ks
       JOIN materials m ON m.id=ks.material_id AND m.owner_id=ks.owner_id
       LEFT JOIN chunks c ON c.material_id=m.id AND c.owner_id=m.owner_id
       WHERE ks.knowledge_item_id=$1 AND ks.owner_id=$2
       GROUP BY m.id ORDER BY m.updated_at DESC`,
      [knowledgeItemId, ownerId],
    ),
    pool.query(
      `SELECT c.id,c.material_id AS "materialId",c.position,left(c.content,500) AS excerpt
       FROM knowledge_evidence ke
       JOIN chunks c ON c.id=ke.chunk_id AND c.owner_id=ke.owner_id
       WHERE ke.knowledge_item_id=$1 AND ke.owner_id=$2
       ORDER BY c.material_id,c.position LIMIT 12`,
      [knowledgeItemId, ownerId],
    ),
  ]);
  return { ...item.rows[0], sources: sources.rows, evidence: evidence.rows };
}

export async function updateKnowledge(ownerId: string, knowledgeItemId: string, update: KnowledgeUpdate, requestId?: string) {
  const fields: string[] = [];
  const values: unknown[] = [knowledgeItemId, ownerId];
  for (const [column, value] of [
    ["title", update.title],
    ["summary", update.summary],
    ["highlights", update.highlights ? JSON.stringify(update.highlights) : undefined],
    ["type", update.type],
  ] as const) {
    if (value === undefined) continue;
    values.push(value);
    fields.push(`${column}=$${values.length}${column === "highlights" ? "::jsonb" : ""}`);
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE knowledge_items SET ${fields.join(",")},updated_at=now()
       WHERE id=$1 AND owner_id=$2
       RETURNING id,type,status,title,summary,highlights,confidence,updated_at AS "updatedAt"`,
      values,
    );
    if (!updated.rows[0]) throw new AppError("KNOWLEDGE_NOT_FOUND", "The knowledge item was not found.", 404);
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','knowledge.edit','knowledge_item',$2,'updated',$3,$4::jsonb)`,
      [ownerId, knowledgeItemId, requestId ?? null, JSON.stringify({ fields: Object.keys(update).sort() })],
    );
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
