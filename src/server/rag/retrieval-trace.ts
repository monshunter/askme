import type { Pool, PoolClient } from "pg";

import type { RuntimeConfig } from "@/server/config";

import type { RagCoverage } from "./evidence-orchestrator";
import type { RetrievedRagEvidence } from "./hybrid-retriever";
import type { RagQueryPlan } from "./query-planner";

type Queryable = Pick<Pool | PoolClient, "query">;

type SafeRetrievalResult = {
  plan: RagQueryPlan;
  candidates: RetrievedRagEvidence[];
  coverage: RagCoverage;
  unsupportedAspects: string[];
  roundCount: number;
  routeCounts: Array<Record<string, number>>;
  degradations: string[];
  configuredTokens: number;
  effectiveTokens: number;
  actualTokens: number;
};

export async function persistRetrievalTrace(queryable: Queryable, input: {
  ownerId: string;
  conversationId: string;
  messageId: string;
  callerMode: "candidate_preview" | "public_answer";
  config: RuntimeConfig;
  result: SafeRetrievalResult;
  latencyMs: number;
}) {
  const planner = {
    entities: input.result.plan.entities,
    mustTerms: input.result.plan.mustTerms,
    shouldTerms: input.result.plan.shouldTerms,
    semanticQueryCount: input.result.plan.semanticQueries.length,
    desiredEvidenceTypes: input.result.plan.desiredEvidenceTypes,
    unsupportedAspects: input.result.unsupportedAspects,
  };
  const selected = input.result.candidates.map((item) => ({
    evidenceId: item.evidenceId,
    sourceKind: item.sourceKind,
    title: item.title,
    path: item.path,
    commitSha: item.commitSha,
    score: item.score,
    rrfScore: item.rrfScore,
    rerankScore: item.rerankScore ?? null,
    routeRanks: item.routeRanks,
  }));
  const indexVersionId = input.result.candidates[0]?.indexVersionId ?? null;
  const stored = await queryable.query<{ id: string }>(
    `INSERT INTO rag_query_traces(owner_id,conversation_id,message_id,caller_mode,policy_version,index_version_id,planner,route_counts,
       selected_evidence,coverage,round_count,degradations,configured_evidence_tokens,effective_evidence_tokens,actual_evidence_tokens,latency_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12::jsonb,$13,$14,$15,$16)
     ON CONFLICT (message_id) DO UPDATE SET planner=excluded.planner,route_counts=excluded.route_counts,selected_evidence=excluded.selected_evidence,
       coverage=excluded.coverage,round_count=excluded.round_count,degradations=excluded.degradations,
       configured_evidence_tokens=excluded.configured_evidence_tokens,effective_evidence_tokens=excluded.effective_evidence_tokens,
       actual_evidence_tokens=excluded.actual_evidence_tokens,latency_ms=excluded.latency_ms
     RETURNING id`,
    [input.ownerId, input.conversationId, input.messageId, input.callerMode, input.config.rag.policyVersion, indexVersionId,
      JSON.stringify(planner), JSON.stringify(input.result.routeCounts), JSON.stringify(selected), input.result.coverage, input.result.roundCount,
      JSON.stringify(input.result.degradations), input.result.configuredTokens, input.result.effectiveTokens, input.result.actualTokens, Math.max(0, Math.round(input.latencyMs))],
  );
  return stored.rows[0]?.id ?? null;
}
