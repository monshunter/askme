import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";

import type { KnowledgeUpdate } from "./knowledge-input";
import type { KnowledgeListQuery } from "./knowledge-query";

type KnowledgeListRow = {
  id: string;
  sourceKind: "knowledge_item" | "repository_wiki";
  type: string;
  status: string;
  title: string;
  summary: string;
  highlights: string[];
  confidence: number | null;
  sourceCount: number;
  chunkCount: number;
  wikiPageCount: number | null;
  sourceTitles: string[];
  sourceVisibilities: string[];
  citationReady: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function unifiedOrderBy(sort: KnowledgeListQuery["sort"]) {
  if (sort === "confidence") return `confidence DESC NULLS LAST,"updatedAt" DESC,id DESC,"sourceKind" DESC`;
  if (sort === "title") return `"sortTitle" ASC,id ASC,"sourceKind" ASC`;
  return `"updatedAt" DESC,id DESC,"sourceKind" DESC`;
}

const repositoryProjectionReady = `
  EXISTS (
    SELECT 1 FROM repository_wiki_pages ready_page
    JOIN repository_wiki_projection_pages ready_projected
      ON ready_projected.page_id=ready_page.id AND ready_projected.dossier_id=ready_page.dossier_id AND ready_projected.projection_id=projection.id
    WHERE ready_page.dossier_id=dossier.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM repository_wiki_pages expected_page
    WHERE expected_page.dossier_id=dossier.id
      AND NOT EXISTS (
        SELECT 1 FROM repository_wiki_projection_pages expected_projected
        WHERE expected_projected.page_id=expected_page.id AND expected_projected.dossier_id=expected_page.dossier_id
          AND expected_projected.projection_id=projection.id
      )
  )
`;

export async function listKnowledge(ownerId: string, query: KnowledgeListQuery) {
  const legacyWhere = `
    ki.owner_id=$1 AND ki.status=$2
    AND ($3::text IS NULL OR ki.type::text=$3::text)
    AND ($4::text IS NULL OR (
      ki.search_vector @@ websearch_to_tsquery('simple',$4::text)
      OR ki.title ILIKE '%' || $4::text || '%'
      OR EXISTS (
        SELECT 1 FROM knowledge_evidence search_ke
        JOIN chunks search_c ON search_c.id=search_ke.chunk_id AND search_c.owner_id=search_ke.owner_id
        WHERE search_ke.knowledge_item_id=ki.id AND search_ke.owner_id=$1
          AND search_c.search_vector @@ websearch_to_tsquery('simple',$4::text)
      )
      OR EXISTS (
        SELECT 1 FROM knowledge_sources search_ks
        JOIN materials search_m ON search_m.id=search_ks.material_id AND search_m.owner_id=search_ks.owner_id
        WHERE search_ks.knowledge_item_id=ki.id AND search_ks.owner_id=$1
          AND (search_m.title ILIKE '%' || $4::text || '%' OR coalesce(search_m.original_name,'') ILIKE '%' || $4::text || '%' OR coalesce(search_m.external_url,'') ILIKE '%' || $4::text || '%')
      )
    ))
    AND ($5::boolean IS NULL OR EXISTS (
      SELECT 1 FROM knowledge_sources ready_ks
      JOIN materials ready_m ON ready_m.id=ready_ks.material_id AND ready_m.owner_id=ready_ks.owner_id
      WHERE ready_ks.knowledge_item_id=ki.id AND ready_ks.owner_id=$1 AND ready_m.visibility IN ('citation_allowed','public_preview')
    )=$5::boolean)
  `;
  const repositoryWhere = `
    repository.owner_id=$1 AND repository.disabled_at IS NULL AND repository.visibility<>'private'
    AND $2::text='active'
    AND ($3::text IS NULL OR $3::text='repository')
    AND ($4::text IS NULL OR (
      repository.display_name ILIKE '%' || $4::text || '%'
      OR dossier.wiki_title ILIKE '%' || $4::text || '%'
      OR dossier.wiki_summary ILIKE '%' || $4::text || '%'
      OR EXISTS (
        SELECT 1 FROM repository_wiki_pages search_page
        JOIN repository_wiki_projection_pages search_projected
          ON search_projected.page_id=search_page.id AND search_projected.dossier_id=search_page.dossier_id AND search_projected.projection_id=projection.id
        WHERE search_page.dossier_id=dossier.id
          AND (search_page.title ILIKE '%' || $4::text || '%' OR coalesce(search_projected.edited_markdown,search_page.generated_markdown) ILIKE '%' || $4::text || '%')
      )
    ))
    AND ($5::boolean IS NULL OR (repository.visibility IN ('citation_allowed','public_preview'))=$5::boolean)
    AND ${repositoryProjectionReady}
  `;
  const offset = (query.page - 1) * query.pageSize;
  const filterValues = [ownerId, query.status, query.type ?? null, query.search ?? null, query.citationReady ?? null];
  const listValues = [...filterValues, query.pageSize, offset];
  const pool = getPool();
  const [itemsResult, totalResult, countsResult, repositoryTotalResult, repositoryCountResult] = await Promise.all([
    pool.query<KnowledgeListRow>(
      `WITH unified AS (
        SELECT ki.id,'knowledge_item'::text AS "sourceKind",ki.type::text AS type,ki.status::text AS status,ki.title,ki.summary,ki.highlights,ki.confidence,
              count(DISTINCT ks.material_id)::int AS "sourceCount",
              count(DISTINCT c.id)::int AS "chunkCount",
              NULL::int AS "wikiPageCount",
              coalesce(jsonb_agg(DISTINCT m.title) FILTER (WHERE m.id IS NOT NULL),'[]'::jsonb) AS "sourceTitles",
              coalesce(jsonb_agg(DISTINCT m.visibility) FILTER (WHERE m.id IS NOT NULL),'[]'::jsonb) AS "sourceVisibilities",
              coalesce(bool_or(m.visibility IN ('citation_allowed','public_preview')),false) AND count(DISTINCT c.id)>0 AS "citationReady",
              ki.created_at AS "createdAt",ki.updated_at AS "updatedAt",lower(ki.title) AS "sortTitle"
        FROM knowledge_items ki
        LEFT JOIN knowledge_sources ks ON ks.knowledge_item_id=ki.id AND ks.owner_id=ki.owner_id
        LEFT JOIN materials m ON m.id=ks.material_id AND m.owner_id=ks.owner_id
        LEFT JOIN knowledge_evidence ke ON ke.knowledge_item_id=ki.id AND ke.owner_id=ki.owner_id
        LEFT JOIN chunks c ON c.id=ke.chunk_id AND c.owner_id=ke.owner_id
        WHERE ${legacyWhere}
        GROUP BY ki.id

        UNION ALL

        SELECT repository.id,'repository_wiki'::text AS "sourceKind",'repository'::text AS type,'active'::text AS status,
              dossier.wiki_title AS title,dossier.wiki_summary AS summary,'[]'::jsonb AS highlights,NULL::real AS confidence,
              1::int AS "sourceCount",0::int AS "chunkCount",count(DISTINCT page.id)::int AS "wikiPageCount",
              jsonb_build_array(repository.display_name) AS "sourceTitles",jsonb_build_array(repository.visibility) AS "sourceVisibilities",
              repository.visibility IN ('citation_allowed','public_preview') AS "citationReady",
              dossier.created_at AS "createdAt",greatest(repository.updated_at,projection.updated_at) AS "updatedAt",lower(dossier.wiki_title) AS "sortTitle"
        FROM repositories repository
        JOIN repository_revisions revision ON revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id
        JOIN repository_dossier_projections projection ON projection.id=repository.active_projection_id AND projection.state='approved'
        JOIN repository_dossiers dossier ON dossier.id=projection.dossier_id AND dossier.repository_id=repository.id
          AND dossier.revision_id=revision.id AND dossier.owner_id=repository.owner_id AND dossier.wiki_manifest IS NOT NULL
        JOIN repository_wiki_pages page ON page.dossier_id=dossier.id
        JOIN repository_wiki_projection_pages projected ON projected.projection_id=projection.id AND projected.page_id=page.id AND projected.dossier_id=dossier.id
        WHERE ${repositoryWhere}
        GROUP BY repository.id,dossier.id,projection.id
      )
      SELECT id,"sourceKind",type,status,title,summary,highlights,confidence,"sourceCount","chunkCount","wikiPageCount",
             "sourceTitles","sourceVisibilities","citationReady","createdAt","updatedAt"
      FROM unified
      ORDER BY ${unifiedOrderBy(query.sort)}
      LIMIT $6 OFFSET $7`,
      listValues,
    ),
    pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM knowledge_items ki WHERE ${legacyWhere}`, filterValues),
    pool.query<{ type: string; count: number }>(
      `SELECT type,count(*)::int AS count FROM knowledge_items WHERE owner_id=$1 AND status=$2 GROUP BY type ORDER BY type`,
      [ownerId, query.status],
    ),
    pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM repositories repository
       JOIN repository_revisions revision ON revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id
       JOIN repository_dossier_projections projection ON projection.id=repository.active_projection_id AND projection.state='approved'
       JOIN repository_dossiers dossier ON dossier.id=projection.dossier_id AND dossier.repository_id=repository.id
         AND dossier.revision_id=revision.id AND dossier.owner_id=repository.owner_id AND dossier.wiki_manifest IS NOT NULL
       WHERE ${repositoryWhere}`,
      filterValues,
    ),
    pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM repositories repository
       JOIN repository_revisions revision ON revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id
       JOIN repository_dossier_projections projection ON projection.id=repository.active_projection_id AND projection.state='approved'
       JOIN repository_dossiers dossier ON dossier.id=projection.dossier_id AND dossier.repository_id=repository.id
         AND dossier.revision_id=revision.id AND dossier.owner_id=repository.owner_id AND dossier.wiki_manifest IS NOT NULL
       WHERE repository.owner_id=$1 AND repository.disabled_at IS NULL AND repository.visibility<>'private' AND $2::boolean
         AND ${repositoryProjectionReady}`,
      [ownerId, query.status === "active"],
    ),
  ]);
  const total = (totalResult.rows[0]?.total ?? 0) + (repositoryTotalResult.rows[0]?.total ?? 0);
  const counts = Object.fromEntries(countsResult.rows.map((row) => [row.type, row.count]));
  const repositoryCount = repositoryCountResult.rows[0]?.count ?? 0;
  counts.repository = (counts.repository ?? 0) + repositoryCount;
  return { items: itemsResult.rows, counts: { all: Object.values(counts).reduce((sum, value) => sum + value, 0), ...counts }, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
}

export async function getKnowledgeDetail(ownerId: string, knowledgeItemId: string) {
  const pool = getPool();
  const item = await pool.query<KnowledgeListRow>(
    `SELECT ki.id,'knowledge_item'::text AS "sourceKind",ki.type,ki.status,ki.title,ki.summary,ki.highlights,ki.confidence,
            count(DISTINCT ks.material_id)::int AS "sourceCount",count(DISTINCT c.id)::int AS "chunkCount",
            NULL::int AS "wikiPageCount",
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
