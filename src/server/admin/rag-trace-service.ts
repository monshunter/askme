import { getPool } from "@/server/db/client";

export async function listAdminRagTraces(limit = 50) {
  const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
  const result = await getPool().query(
    `SELECT trace.id,trace.owner_id AS "ownerId",owner.display_name AS "candidateName",trace.message_id AS "messageId",
            trace.caller_mode AS "callerMode",trace.policy_version AS "policyVersion",trace.index_version_id AS "indexVersionId",
            trace.planner,trace.route_counts AS "routeCounts",trace.selected_evidence AS "selectedEvidence",trace.coverage,
            trace.round_count AS "roundCount",trace.degradations,trace.configured_evidence_tokens AS "configuredEvidenceTokens",
            trace.effective_evidence_tokens AS "effectiveEvidenceTokens",trace.actual_evidence_tokens AS "actualEvidenceTokens",
            trace.latency_ms AS "latencyMs",trace.created_at AS "createdAt"
     FROM rag_query_traces trace JOIN users owner ON owner.id=trace.owner_id
     ORDER BY trace.created_at DESC,trace.id DESC LIMIT $1`,
    [bounded],
  );
  return { items: result.rows, limit: bounded };
}
