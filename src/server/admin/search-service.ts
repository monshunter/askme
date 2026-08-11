import "server-only";

import { getPool } from "@/server/db/client";

function searchPattern(search: string) {
  return `%${search.replace(/[\\%_]/g, "\\$&")}%`;
}

export async function searchAdminWorkspace(search: string) {
  const pattern = searchPattern(search);
  const [candidatesResult, agentsResult, reviewsResult] = await Promise.all([
    getPool().query(
      `SELECT id,display_name AS "displayName",email,status,created_at AS "createdAt"
       FROM users WHERE role='candidate' AND (display_name ILIKE $1 ESCAPE '\\' OR email ILIKE $1 ESCAPE '\\')
       ORDER BY updated_at DESC,id DESC LIMIT 10`,
      [pattern],
    ),
    getPool().query(
      `SELECT publication.id,publication.slug,publication.status,publication.updated_at AS "updatedAt",
              candidate.display_name AS "displayName",candidate.headline
       FROM publications publication JOIN users candidate ON candidate.id=publication.owner_id
       WHERE publication.status<>'draft' AND (candidate.display_name ILIKE $1 ESCAPE '\\'
         OR coalesce(candidate.headline,'') ILIKE $1 ESCAPE '\\' OR publication.slug ILIKE $1 ESCAPE '\\')
       ORDER BY publication.updated_at DESC,publication.id DESC LIMIT 10`,
      [pattern],
    ),
    getPool().query(
      `SELECT flag.id,flag.category,flag.severity,flag.status,flag.safe_summary AS "safeSummary",flag.updated_at AS "updatedAt"
       FROM content_flags flag
       WHERE flag.safe_summary ILIKE $1 ESCAPE '\\' OR flag.category ILIKE $1 ESCAPE '\\'
       ORDER BY flag.updated_at DESC,flag.id DESC LIMIT 10`,
      [pattern],
    ),
  ]);
  return { query: search, candidates: candidatesResult.rows, agents: agentsResult.rows, reviews: reviewsResult.rows };
}
