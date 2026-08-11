import type { Pool } from "pg";

import { allowedVisibilities, type MaterialVisibility, type VisibilityConsumer } from "@/server/privacy/visibility-policy";

import { buildEvidenceSearchQuery, parseEvidenceQuery, type EvidenceQuery } from "./retrieval-input";

export type RetrievedEvidence = {
  chunkId: string;
  materialId: string;
  materialTitle: string;
  materialKind: "file" | "github" | "notion" | "website";
  externalUrl: string | null;
  visibility: MaterialVisibility;
  position: number;
  content: string;
  score: number;
};

function escapeLikePattern(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

export async function searchEvidence(
  pool: Pool,
  ownerId: string,
  consumer: VisibilityConsumer,
  input: EvidenceQuery,
): Promise<RetrievedEvidence[]> {
  const query = parseEvidenceQuery(input);
  const searchQuery = buildEvidenceSearchQuery(query.query);
  const result = await pool.query<RetrievedEvidence>(
    `SELECT c.id AS "chunkId",c.material_id AS "materialId",m.title AS "materialTitle",m.kind AS "materialKind",
            m.external_url AS "externalUrl",m.visibility,c.position,c.content,
            greatest(
              ts_rank_cd(c.search_vector,websearch_to_tsquery('simple',$3)),
              coalesce((
                SELECT max(ts_rank_cd(ki.search_vector,websearch_to_tsquery('simple',$3)))
                FROM knowledge_evidence ke
                JOIN knowledge_items ki ON ki.id=ke.knowledge_item_id AND ki.owner_id=ke.owner_id AND ki.status='active'
                WHERE ke.chunk_id=c.id AND ke.owner_id=$1
              ),0)
            )::real AS score
     FROM chunks c
     JOIN materials m ON m.id=c.material_id AND m.owner_id=c.owner_id
     WHERE c.owner_id=$1 AND m.owner_id=$1 AND m.status='indexed' AND m.visibility=ANY($2::visibility[])
       AND (
         c.search_vector @@ websearch_to_tsquery('simple',$3)
         OR c.content ILIKE $4 ESCAPE '\\'
         OR EXISTS (
           SELECT 1 FROM knowledge_evidence ke
           JOIN knowledge_items ki ON ki.id=ke.knowledge_item_id AND ki.owner_id=ke.owner_id AND ki.status='active'
           WHERE ke.chunk_id=c.id AND ke.owner_id=$1
             AND (ki.search_vector @@ websearch_to_tsquery('simple',$3) OR ki.title ILIKE $4 ESCAPE '\\' OR ki.summary ILIKE $4 ESCAPE '\\')
         )
       )
     ORDER BY score DESC,m.updated_at DESC,c.position ASC,c.id ASC
     LIMIT $5`,
    [ownerId, allowedVisibilities(consumer), searchQuery, escapeLikePattern(query.query), query.limit],
  );
  return result.rows;
}
