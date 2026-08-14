import type { Pool } from "pg";

export type EffectiveQuestionRoute = "rag" | "deep" | "refuse";

export async function recordQuestionRoute(pool: Pool, input: {
  ownerId: string;
  actorRole: "candidate" | "interviewer";
  conversationId: string;
  requestedRoute: EffectiveQuestionRoute;
  effectiveRoute: EffectiveQuestionRoute;
  reasonCode: string;
  confidence: number;
  repositoryId: string | null;
  evidenceCount: number;
  requestId?: string;
}) {
  await pool.query(
    `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
     VALUES ($1,$2,'agent.question.route','conversation',$3,$4,$5,$6::jsonb)`,
    [
      input.actorRole === "candidate" ? input.ownerId : null,
      input.actorRole,
      input.conversationId,
      input.effectiveRoute,
      input.requestId ?? null,
      JSON.stringify({
        requestedRoute: input.requestedRoute,
        effectiveRoute: input.effectiveRoute,
        reasonCode: input.reasonCode,
        confidence: input.confidence,
        repositoryId: input.repositoryId,
        evidenceCount: input.evidenceCount,
      }),
    ],
  );
}
