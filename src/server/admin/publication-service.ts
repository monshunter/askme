import "server-only";

import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { requestPublicationAnalysisCancellation } from "@/server/code-agent/analysis-cancellation";

import { publicationStatusTransition } from "./admin-state";
import type { PublicationActionInput } from "./admin-input";

export type AdminAgentListQuery = {
  search: string;
  status: "all" | "published" | "paused" | "revoked";
  page: number;
  pageSize: number;
};

function searchPattern(search: string) {
  return `%${search.replace(/[\\%_]/g, "\\$&")}%`;
}

export async function listAdminAgents(query: AdminAgentListQuery) {
  const pattern = searchPattern(query.search);
  const offset = (query.page - 1) * query.pageSize;
  const filters = `publication.status <> 'draft'
    AND ($1='' OR candidate.display_name ILIKE $2 ESCAPE '\\' OR coalesce(candidate.headline,'') ILIKE $2 ESCAPE '\\' OR publication.slug ILIKE $2 ESCAPE '\\')
    AND ($3='all' OR publication.status::text=$3)`;
  const [itemsResult, countResult] = await Promise.all([
    getPool().query(
      `SELECT publication.id,publication.slug,publication.status,publication.published_at AS "publishedAt",
              publication.paused_at AS "pausedAt",publication.pause_reason AS "pauseReason",publication.updated_at AS "updatedAt",
              candidate.id AS "candidateId",candidate.display_name AS "displayName",candidate.headline,candidate.status AS "accountStatus",
              (SELECT count(*)::int FROM materials
                WHERE owner_id=publication.owner_id AND status='indexed' AND visibility IN ('citation_allowed','public_preview')) AS "publicSources",
              (SELECT count(*)::int FROM knowledge_items knowledge
                WHERE knowledge.owner_id=publication.owner_id AND knowledge.status='active' AND EXISTS (
                  SELECT 1 FROM knowledge_evidence evidence
                  JOIN chunks chunk ON chunk.id=evidence.chunk_id AND chunk.owner_id=evidence.owner_id
                  JOIN materials material ON material.id=chunk.material_id AND material.owner_id=chunk.owner_id
                  WHERE evidence.knowledge_item_id=knowledge.id AND evidence.owner_id=knowledge.owner_id
                    AND material.status='indexed' AND material.visibility IN ('citation_allowed','public_preview')
                )) AS "publicKnowledgeItems"
       FROM publications publication
       JOIN users candidate ON candidate.id=publication.owner_id AND candidate.role='candidate'
       WHERE ${filters}
       ORDER BY publication.updated_at DESC,publication.id DESC LIMIT $4 OFFSET $5`,
      [query.search, pattern, query.status, query.pageSize, offset],
    ),
    getPool().query<{ total: number }>(
      `SELECT count(*)::int AS total FROM publications publication
       JOIN users candidate ON candidate.id=publication.owner_id AND candidate.role='candidate'
       WHERE ${filters}`,
      [query.search, pattern, query.status],
    ),
  ]);
  const total = countResult.rows[0]?.total ?? 0;
  return { items: itemsResult.rows, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
}

export async function governPublication(actorId: string, publicationId: string, input: PublicationActionInput, requestId?: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const publicationResult = await client.query<{
      id: string;
      status: "draft" | "published" | "paused" | "revoked";
      ownerId: string;
      accountStatus: "active" | "suspended";
    }>(
      `SELECT publication.id,publication.status,publication.owner_id AS "ownerId",candidate.status AS "accountStatus"
       FROM publications publication JOIN users candidate ON candidate.id=publication.owner_id
       WHERE publication.id=$1 FOR UPDATE OF publication`,
      [publicationId],
    );
    const publication = publicationResult.rows[0];
    if (!publication) throw new AppError("PUBLICATION_NOT_FOUND", "The published Agent was not found.", 404);
    const transition = publicationStatusTransition(publication.status, input.action);
    if (input.action === "restore" && transition.changed && publication.accountStatus !== "active") {
      throw new AppError("CANDIDATE_SUSPENDED", "Restore the Candidate account before restoring this Agent.", 409);
    }
    if (transition.changed) {
      const updated = input.action === "pause"
        ? await client.query(
            `UPDATE publications SET status='paused',paused_at=now(),pause_reason=$2,updated_at=now()
             WHERE id=$1 AND status='published'`,
            [publicationId, input.reason],
          )
        : await client.query(
            `UPDATE publications SET status='published',paused_at=NULL,pause_reason=NULL,updated_at=now()
             WHERE id=$1 AND status='paused'`,
            [publicationId],
          );
      if (updated.rowCount !== 1) throw new AppError("AGENT_STATE_CONFLICT", "The Agent state changed before the action completed.", 409);
      if (input.action === "pause") await requestPublicationAnalysisCancellation(client, publicationId, "publication_paused");
    }
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'admin',$2,'publication',$3,$4,$5,$6::jsonb)`,
      [actorId, `admin.publication.${input.action}`, publicationId, transition.changed ? transition.next : "unchanged", requestId ?? null, JSON.stringify({ previousStatus: publication.status, nextStatus: transition.next, reason: input.reason })],
    );
    await client.query("COMMIT");
    return { id: publicationId, status: transition.next, changed: transition.changed };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
