import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";

export type HighlightKnowledgeType = "project" | "experience" | "skill" | "article" | "repository" | "summary";

export type FeaturedHighlightItem = {
  id: string;
  type: HighlightKnowledgeType;
  title: string;
  summary: string;
  highlights: string[];
  eligible: boolean;
};

export type HighlightCandidateItem = {
  id: string;
  type: HighlightKnowledgeType;
  title: string;
  summary: string;
  highlights: string[];
  confidence: number;
};

export type HighlightCuration = {
  featured: FeaturedHighlightItem[];
  items: HighlightCandidateItem[];
  page: number;
  totalPages: number;
};

const HIGHLIGHT_PAGE_SIZE = 5;
const HIGHLIGHT_MAX_FEATURED = 5;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const HIGHLIGHT_ELIGIBLE = `EXISTS (
  SELECT 1 FROM knowledge_evidence evidence
  JOIN chunks chunk ON chunk.id=evidence.chunk_id AND chunk.owner_id=evidence.owner_id
  JOIN materials material ON material.id=chunk.material_id AND material.owner_id=chunk.owner_id
  WHERE evidence.knowledge_item_id=knowledge.id AND evidence.owner_id=knowledge.owner_id
    AND material.status='indexed' AND material.visibility='public_preview'
)`;

export function parseHighlightSelection(body: unknown): string[] {
  const candidate = (body as { knowledgeItemIds?: unknown } | null)?.knowledgeItemIds;
  if (!Array.isArray(candidate) || !candidate.every((item): item is string => typeof item === "string" && UUID_PATTERN.test(item))) {
    throw new AppError("INVALID_HIGHLIGHTS", "Choose valid knowledge items to feature.", 400);
  }
  const ids = [...new Set(candidate)];
  if (ids.length > HIGHLIGHT_MAX_FEATURED) throw new AppError("INVALID_HIGHLIGHTS", "Choose at most 5 knowledge items to feature.", 400);
  return ids;
}

export async function loadHighlightCuration(ownerId: string, page = 1): Promise<HighlightCuration> {
  const pool = getPool();
  const offset = Math.max(0, (page - 1) * HIGHLIGHT_PAGE_SIZE);
  const [featuredResult, itemsResult, countResult] = await Promise.all([
    pool.query<FeaturedHighlightItem>(
      `SELECT knowledge.id,knowledge.type,knowledge.title,knowledge.summary,knowledge.highlights,
              (${HIGHLIGHT_ELIGIBLE}) AS "eligible"
       FROM knowledge_items knowledge
       WHERE knowledge.owner_id=$1 AND knowledge.featured_at IS NOT NULL AND knowledge.status='active'
       ORDER BY knowledge.featured_at ASC,knowledge.id ASC LIMIT ${HIGHLIGHT_MAX_FEATURED}`,
      [ownerId],
    ),
    pool.query<HighlightCandidateItem>(
      `SELECT knowledge.id,knowledge.type,knowledge.title,knowledge.summary,knowledge.highlights,knowledge.confidence
       FROM knowledge_items knowledge
       WHERE knowledge.owner_id=$1 AND knowledge.status='active' AND knowledge.featured_at IS NULL
         AND (${HIGHLIGHT_ELIGIBLE})
       ORDER BY knowledge.confidence DESC,knowledge.updated_at DESC,knowledge.id DESC
       LIMIT ${HIGHLIGHT_PAGE_SIZE} OFFSET $2`,
      [ownerId, offset],
    ),
    pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM knowledge_items knowledge
       WHERE knowledge.owner_id=$1 AND knowledge.status='active' AND knowledge.featured_at IS NULL
         AND (${HIGHLIGHT_ELIGIBLE})`,
      [ownerId],
    ),
  ]);
  return {
    featured: featuredResult.rows.map((item) => ({ ...item, highlights: item.highlights.slice(0, 3) })),
    items: itemsResult.rows.map((item) => ({ ...item, highlights: item.highlights.slice(0, 3) })),
    page: Math.max(1, page),
    totalPages: Math.max(1, Math.ceil((countResult.rows[0]?.total ?? 0) / HIGHLIGHT_PAGE_SIZE)),
  };
}

export async function saveFeaturedHighlights(ownerId: string, knowledgeItemIds: string[], requestId?: string): Promise<{ featured: FeaturedHighlightItem[] }> {
  const ids = [...new Set(knowledgeItemIds)];
  if (ids.length > HIGHLIGHT_MAX_FEATURED) throw new AppError("HIGHLIGHT_LIMIT_EXCEEDED", "Feature at most 5 highlights.", 409);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const eligible = await client.query<{ id: string }>(
      `SELECT knowledge.id FROM knowledge_items knowledge
       WHERE knowledge.owner_id=$1 AND knowledge.id=ANY($2::uuid[]) AND knowledge.status='active'
         AND (${HIGHLIGHT_ELIGIBLE})`,
      [ownerId, ids],
    );
    if (eligible.rows.length !== ids.length) {
      throw new AppError("HIGHLIGHT_NOT_ELIGIBLE", "Every highlighted knowledge item must be active and publicly eligible.", 400);
    }
    const previous = await client.query<{ id: string }>(
      "SELECT id FROM knowledge_items WHERE owner_id=$1 AND featured_at IS NOT NULL",
      [ownerId],
    );
    await client.query("UPDATE knowledge_items SET featured_at=NULL WHERE owner_id=$1 AND featured_at IS NOT NULL", [ownerId]);
    for (const [index, itemId] of ids.entries()) {
      await client.query("UPDATE knowledge_items SET featured_at=$3 WHERE id=$1 AND owner_id=$2", [itemId, ownerId, new Date(Date.now() + index)]);
    }
    const removed = previous.rows.filter((item) => !ids.includes(item.id)).map((item) => item.id);
    for (const itemId of [...ids, ...removed]) {
      const outcome = ids.includes(itemId) ? "featured" : "unfeatured";
      await client.query(
        `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
         VALUES ($1,'candidate','agent.highlights.save','knowledge_item',$2,$3,$4,$5::jsonb)`,
        [ownerId, itemId, outcome, requestId ?? null, JSON.stringify({})],
      );
    }
    await client.query("COMMIT");
    return { featured: (await loadHighlightCuration(ownerId, 1)).featured };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
