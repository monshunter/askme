import "server-only";

import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";

import { contentReviewTransition } from "./admin-state";
import type { ContentReviewInput } from "./admin-input";

export type AdminReviewListQuery = {
  search: string;
  status: "all" | "open" | "reviewing" | "resolved" | "dismissed";
  severity: "all" | "low" | "medium" | "high";
  page: number;
  pageSize: number;
};

function searchPattern(search: string) {
  return `%${search.replace(/[\\%_]/g, "\\$&")}%`;
}

export async function listContentReviews(query: AdminReviewListQuery) {
  const pattern = searchPattern(query.search);
  const offset = (query.page - 1) * query.pageSize;
  const filters = `($1='' OR flag.safe_summary ILIKE $2 ESCAPE '\\' OR flag.category ILIKE $2 ESCAPE '\\'
      OR coalesce(candidate.display_name,'') ILIKE $2 ESCAPE '\\' OR coalesce(publication.slug,'') ILIKE $2 ESCAPE '\\')
    AND ($3='all' OR flag.status::text=$3) AND ($4='all' OR flag.severity::text=$4)`;
  const [itemsResult, countResult] = await Promise.all([
    getPool().query(
      `SELECT flag.id,flag.category,flag.severity,flag.status,flag.safe_summary AS "safeSummary",
              flag.decision_note AS "decisionNote",flag.reviewed_at AS "reviewedAt",
              flag.created_at AS "createdAt",flag.updated_at AS "updatedAt",
              publication.id AS "publicationId",publication.slug,publication.status AS "publicationStatus",
              candidate.display_name AS "displayName",reviewer.display_name AS "reviewedByName"
       FROM content_flags flag
       LEFT JOIN publications publication ON publication.id=flag.publication_id
       LEFT JOIN users candidate ON candidate.id=publication.owner_id
       LEFT JOIN users reviewer ON reviewer.id=flag.reviewed_by
       WHERE ${filters}
       ORDER BY CASE flag.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
                CASE flag.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                flag.created_at ASC,flag.id ASC LIMIT $5 OFFSET $6`,
      [query.search, pattern, query.status, query.severity, query.pageSize, offset],
    ),
    getPool().query<{ total: number }>(
      `SELECT count(*)::int AS total FROM content_flags flag
       LEFT JOIN publications publication ON publication.id=flag.publication_id
       LEFT JOIN users candidate ON candidate.id=publication.owner_id
       WHERE ${filters}`,
      [query.search, pattern, query.status, query.severity],
    ),
  ]);
  const total = countResult.rows[0]?.total ?? 0;
  return { items: itemsResult.rows, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
}

export async function decideContentReview(actorId: string, flagId: string, input: ContentReviewInput, requestId?: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const flagResult = await client.query<{ id: string; status: "open" | "reviewing" | "resolved" | "dismissed" }>(
      "SELECT id,status FROM content_flags WHERE id=$1 FOR UPDATE",
      [flagId],
    );
    const flag = flagResult.rows[0];
    if (!flag) throw new AppError("CONTENT_FLAG_NOT_FOUND", "The content review item was not found.", 404);
    const transition = contentReviewTransition(flag.status, input.action);
    if (transition.changed) {
      const updated = await client.query(
        `UPDATE content_flags SET status=$2::flag_status,reviewed_by=$3,reviewed_at=now(),decision_note=$4,updated_at=now()
         WHERE id=$1 AND status=$5::flag_status`,
        [flagId, transition.next, actorId, input.note, flag.status],
      );
      if (updated.rowCount !== 1) throw new AppError("REVIEW_STATE_CONFLICT", "The review item changed before the decision completed.", 409);
    }
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'admin',$2,'content_flag',$3,$4,$5,$6::jsonb)`,
      [actorId, `admin.content.${input.action}`, flagId, transition.changed ? transition.next : "unchanged", requestId ?? null, JSON.stringify({ previousStatus: flag.status, nextStatus: transition.next, decisionNote: input.note })],
    );
    await client.query("COMMIT");
    return { id: flagId, status: transition.next, changed: transition.changed };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
