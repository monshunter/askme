import "server-only";

import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { requestOwnerAnalysisCancellation } from "@/server/code-agent/analysis-cancellation";

import { candidateStatusTransition } from "./admin-state";
import type { CandidateStatusInput } from "./admin-input";

export type CandidateListQuery = {
  search: string;
  status: "all" | "active" | "suspended";
  page: number;
  pageSize: number;
};

function searchPattern(search: string) {
  return `%${search.replace(/[\\%_]/g, "\\$&")}%`;
}

export async function listAdminCandidates(query: CandidateListQuery) {
  const pattern = searchPattern(query.search);
  const offset = (query.page - 1) * query.pageSize;
  const [itemsResult, countResult] = await Promise.all([
    getPool().query(
      `SELECT candidate.id,candidate.display_name AS "displayName",candidate.email,candidate.status,
              candidate.created_at AS "createdAt",candidate.updated_at AS "updatedAt",
              (SELECT count(*)::int FROM materials WHERE owner_id=candidate.id) AS "materialCount",
              (SELECT count(*)::int FROM knowledge_items WHERE owner_id=candidate.id AND status='active') AS "knowledgeCount",
              (SELECT status FROM publications WHERE owner_id=candidate.id ORDER BY updated_at DESC,id DESC LIMIT 1) AS "publicationStatus"
       FROM users candidate
       WHERE candidate.role='candidate'
         AND ($1='' OR candidate.display_name ILIKE $2 ESCAPE '\\' OR candidate.email ILIKE $2 ESCAPE '\\')
         AND ($3='all' OR candidate.status::text=$3)
       ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT $4 OFFSET $5`,
      [query.search, pattern, query.status, query.pageSize, offset],
    ),
    getPool().query<{ total: number }>(
      `SELECT count(*)::int AS total FROM users candidate
       WHERE candidate.role='candidate'
         AND ($1='' OR candidate.display_name ILIKE $2 ESCAPE '\\' OR candidate.email ILIKE $2 ESCAPE '\\')
         AND ($3='all' OR candidate.status::text=$3)`,
      [query.search, pattern, query.status],
    ),
  ]);
  const total = countResult.rows[0]?.total ?? 0;
  return { items: itemsResult.rows, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
}

export async function changeCandidateStatus(actorId: string, candidateId: string, input: CandidateStatusInput, requestId?: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const candidateResult = await client.query<{ id: string; status: "active" | "suspended" }>(
      "SELECT id,status FROM users WHERE id=$1 AND role='candidate' FOR UPDATE",
      [candidateId],
    );
    const candidate = candidateResult.rows[0];
    if (!candidate) throw new AppError("CANDIDATE_NOT_FOUND", "The Candidate account was not found.", 404);
    const transition = candidateStatusTransition(candidate.status, input.status);
    if (transition.changed) {
      await client.query("UPDATE users SET status=$2::account_status,updated_at=now() WHERE id=$1 AND role='candidate'", [candidateId, transition.next]);
      if (transition.next === "suspended") {
        await client.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [candidateId]);
        await requestOwnerAnalysisCancellation(client, candidateId, "candidate_suspended");
      }
    }
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'admin','admin.candidate.status','user',$2,$3,$4,$5::jsonb)`,
      [actorId, candidateId, transition.changed ? transition.next : "unchanged", requestId ?? null, JSON.stringify({ previousStatus: candidate.status, nextStatus: transition.next, reason: input.reason })],
    );
    await client.query("COMMIT");
    return { id: candidateId, status: transition.next, changed: transition.changed };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
