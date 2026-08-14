import { createHash } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { RuntimeConfig } from "@/server/config";
import { AppError } from "@/server/errors";

import { codeAgentProfileFingerprint, codeAgentSkillHash, requireCodeAgentImageDigest } from "./provenance";
import { consumeAnalysisDailyQuotas } from "./analysis-quotas";

export type RepositoryAnalysisRun = {
  id: string;
  state: "pending" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  analysisGeneration: number;
  revisionId: string;
  replayed: boolean;
};

export type ConversationAnalysisRun = {
  id: string;
  state: "pending" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  revisionId: string;
  assistantMessageId: string;
  replayed: boolean;
};

const CONVERSATION_ROUTE_VERSION = "repository-question-v1";

type RepositoryContext = {
  ownerId: string;
  repositoryId: string;
  revisionId: string;
  visibility: "private" | "agent_only" | "citation_allowed" | "public_preview";
  disabledAt: Date | null;
  state: string;
  artifactChecksum: string;
  filterFingerprint: string;
};

async function repositoryContext(client: Pool | PoolClient, ownerId: string, repositoryId: string, revisionId?: string): Promise<RepositoryContext> {
  const result = await client.query<RepositoryContext>(
    `SELECT repository.owner_id AS "ownerId",repository.id AS "repositoryId",revision.id AS "revisionId",
            repository.visibility,repository.disabled_at AS "disabledAt",revision.state,
            artifact.checksum AS "artifactChecksum",revision.filter_fingerprint AS "filterFingerprint"
     FROM repositories repository
     JOIN repository_revisions revision ON revision.repository_id=repository.id AND revision.owner_id=repository.owner_id
     JOIN repository_artifacts artifact ON artifact.content_key=revision.artifact_key
     WHERE repository.id=$1 AND repository.owner_id=$2
       AND revision.id=COALESCE($3::uuid,(SELECT newest.id FROM repository_revisions newest WHERE newest.repository_id=repository.id AND newest.owner_id=repository.owner_id ORDER BY newest.created_at DESC,newest.id DESC LIMIT 1))`,
    [repositoryId, ownerId, revisionId ?? null],
  );
  const context = result.rows[0];
  if (!context) throw new AppError("REPOSITORY_NOT_FOUND", "The Repository revision was not found.", 404);
  if (context.disabledAt) throw new AppError("REPOSITORY_DISABLED", "The Repository is disabled.", 409);
  if (context.state !== "stored") throw new AppError("REPOSITORY_REVISION_NOT_READY", "The Repository revision is not ready for analysis.", 409);
  if (context.visibility === "private") throw new AppError("REPOSITORY_ANALYSIS_PRIVATE", "A private Repository cannot be analyzed.", 409);
  return context;
}

export async function queueConversationAnalysisRun(input: {
  pool: Pool;
  config: RuntimeConfig;
  ownerId: string;
  repositoryId: string;
  conversationId: string;
  assistantMessageId: string;
  clientMessageId: string;
  actorRole: "candidate" | "interviewer";
  requestId?: string;
}): Promise<ConversationAnalysisRun> {
  const client = await input.pool.connect();
  try {
    await client.query("BEGIN");
    const context = await client.query<{
      revisionId: string;
    }>(
      `SELECT revision.id AS "revisionId"
       FROM messages assistant
       JOIN conversations conversation ON conversation.id=assistant.conversation_id AND conversation.owner_id=assistant.owner_id
       JOIN messages question ON question.id=assistant.reply_to_message_id AND question.owner_id=assistant.owner_id
       JOIN users owner ON owner.id=assistant.owner_id AND owner.status='active'
       JOIN repositories repository ON repository.id=$2 AND repository.owner_id=assistant.owner_id AND repository.disabled_at IS NULL
       JOIN repository_revisions revision ON revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id AND revision.state='stored'
       JOIN repository_dossier_projections projection ON projection.id=repository.active_projection_id AND projection.state='approved'
       JOIN repository_dossiers dossier ON dossier.id=projection.dossier_id AND dossier.revision_id=revision.id AND dossier.owner_id=repository.owner_id
       LEFT JOIN publications publication ON publication.id=conversation.publication_id AND publication.owner_id=conversation.owner_id
       WHERE assistant.id=$3 AND assistant.owner_id=$1 AND assistant.conversation_id=$4
         AND assistant.role='assistant' AND assistant.status='pending'
         AND question.role='user' AND question.client_message_id=$5
         AND (
           (conversation.mode='preview' AND repository.visibility IN ('agent_only','citation_allowed','public_preview')) OR
           (conversation.mode='public' AND conversation.expires_at>now() AND publication.status='published'
             AND repository.visibility IN ('citation_allowed','public_preview') AND repository.public_deep_analysis_enabled=true)
         )
       FOR UPDATE OF assistant`,
      [input.ownerId, input.repositoryId, input.assistantMessageId, input.conversationId, input.clientMessageId],
    );
    const authorized = context.rows[0];
    if (!authorized) throw new AppError("DEEP_ANALYSIS_NOT_ALLOWED", "Deep Repository analysis is not allowed for this conversation.", 409);
    const imageDigest = requireCodeAgentImageDigest(input.config.codeAgent);
    const skillHash = await codeAgentSkillHash("conversation_analysis");
    const budget = input.config.codeAgent.budgets.conversationAnalysis;
    const profileFingerprint = codeAgentProfileFingerprint(input.config.ai.profiles.code, budget, input.config.codeAgent);
    const key = createHash("sha256").update([
      input.conversationId,
      input.clientMessageId,
      authorized.revisionId,
      CONVERSATION_ROUTE_VERSION,
    ].join("\0")).digest("hex");
    const inserted = await client.query<Omit<ConversationAnalysisRun, "replayed"> & { inserted: boolean }>(
      `INSERT INTO analysis_runs(
         owner_id,purpose,repository_id,revision_id,conversation_id,assistant_message_id,idempotency_key,analysis_generation,
         state,priority,phase,budget_snapshot,image_digest,skill_hash,prompt_version,profile_id,profile_fingerprint,configured_model
       ) VALUES ($1,'conversation_analysis',$2,$3,$4,$5,$6,0,'pending',100,'pending',$7::jsonb,$8,$9,$10,'code',$11,$12)
       ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=analysis_runs.updated_at
       RETURNING id,state,phase,revision_id AS "revisionId",assistant_message_id AS "assistantMessageId",(xmax=0) AS inserted`,
      [
        input.ownerId,
        input.repositoryId,
        authorized.revisionId,
        input.conversationId,
        input.assistantMessageId,
        key,
        JSON.stringify(budget),
        imageDigest,
        skillHash,
        input.config.codeAgent.promptVersion,
        profileFingerprint,
        input.config.ai.profiles.code.model,
      ],
    );
    const run = inserted.rows[0];
    if (!run) throw new AppError("CONVERSATION_ANALYSIS_QUEUE_FAILED", "The deep analysis run could not be queued.", 500);
    if (run.inserted) {
      await client.query("INSERT INTO analysis_run_events(run_id,version,state,phase) VALUES ($1,1,'pending','pending')", [run.id]);
      await client.query(
        `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
         VALUES ($1,$2,'conversation.analysis.queue','analysis_run',$3,'pending',$4,$5::jsonb)`,
        [input.actorRole === "candidate" ? input.ownerId : null, input.actorRole, run.id, input.requestId ?? null, JSON.stringify({ repositoryId: input.repositoryId, revisionId: authorized.revisionId, conversationId: input.conversationId })],
      );
    }
    await client.query("COMMIT");
    return { id: run.id, state: run.state, phase: run.phase, revisionId: run.revisionId, assistantMessageId: run.assistantMessageId, replayed: !run.inserted };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function idempotencyKey(context: RepositoryContext, input: {
  imageDigest: string;
  skillHash: string;
  promptVersion: string;
  profileFingerprint: string;
  generation: number;
}) {
  return createHash("sha256").update([
    context.artifactChecksum,
    context.filterFingerprint,
    input.imageDigest,
    input.skillHash,
    input.promptVersion,
    input.profileFingerprint,
    String(input.generation),
  ].join("\0")).digest("hex");
}

export async function queueRepositoryAnalysisRun(input: {
  pool: Pool;
  config: RuntimeConfig;
  ownerId: string;
  actorId?: string;
  repositoryId: string;
  revisionId?: string;
  explicitRerun?: boolean;
  forceNewGeneration?: boolean;
  actorRole?: "candidate" | "admin" | "system";
  requestId?: string;
}): Promise<RepositoryAnalysisRun> {
  const client = await input.pool.connect();
  try {
    await client.query("BEGIN");
    const context = await repositoryContext(client, input.ownerId, input.repositoryId, input.revisionId);
    const imageDigest = requireCodeAgentImageDigest(input.config.codeAgent);
    const skillHash = await codeAgentSkillHash("repository_analysis");
    const budget = input.config.codeAgent.budgets.repositoryAnalysis;
    const profileFingerprint = codeAgentProfileFingerprint(input.config.ai.profiles.code, budget, input.config.codeAgent);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [context.revisionId]);
    const latest = await client.query<{ generation: number }>(
      "SELECT COALESCE(max(analysis_generation),-1)::int AS generation FROM analysis_runs WHERE repository_id=$1 AND revision_id=$2 AND purpose='repository_analysis'",
      [context.repositoryId, context.revisionId],
    );
    const currentGeneration = latest.rows[0]?.generation ?? -1;
    if (!input.explicitRerun && !input.forceNewGeneration && currentGeneration >= 0) {
      const existing = await client.query<Omit<RepositoryAnalysisRun, "replayed">>(
        `SELECT id,state,phase,analysis_generation AS "analysisGeneration",revision_id AS "revisionId"
         FROM analysis_runs WHERE repository_id=$1 AND revision_id=$2 AND purpose='repository_analysis'
         ORDER BY analysis_generation DESC,created_at DESC,id DESC LIMIT 1`,
        [context.repositoryId, context.revisionId],
      );
      const run = existing.rows[0];
      if (!run) throw new AppError("REPOSITORY_ANALYSIS_QUEUE_FAILED", "The Repository analysis run could not be recovered.", 500);
      await client.query("COMMIT");
      return { ...run, replayed: true };
    }
    const generation = input.explicitRerun || input.forceNewGeneration ? currentGeneration + 1 : 0;
    const key = idempotencyKey(context, {
      imageDigest,
      skillHash,
      promptVersion: input.config.codeAgent.promptVersion,
      profileFingerprint,
      generation,
    });
    const inserted = await client.query<Omit<RepositoryAnalysisRun, "replayed"> & { inserted: boolean }>(
      `INSERT INTO analysis_runs(
         owner_id,purpose,repository_id,revision_id,idempotency_key,analysis_generation,state,priority,phase,budget_snapshot,
         image_digest,skill_hash,prompt_version,profile_id,profile_fingerprint,configured_model
       ) VALUES ($1,'repository_analysis',$2,$3,$4,$5,'pending',0,'pending',$6::jsonb,$7,$8,$9,'code',$10,$11)
       ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=analysis_runs.updated_at
       RETURNING id,state,phase,analysis_generation AS "analysisGeneration",revision_id AS "revisionId",(xmax=0) AS inserted`,
      [
        context.ownerId,
        context.repositoryId,
        context.revisionId,
        key,
        generation,
        JSON.stringify(budget),
        imageDigest,
        skillHash,
        input.config.codeAgent.promptVersion,
        profileFingerprint,
        input.config.ai.profiles.code.model,
      ],
    );
    const run = inserted.rows[0];
    if (!run) throw new AppError("REPOSITORY_ANALYSIS_QUEUE_FAILED", "The Repository analysis run could not be queued.", 500);
    if (run.inserted) {
      await consumeAnalysisDailyQuotas(client, input.config.codeAgent, [
        { type: "global", key: "global" },
        { type: "candidate", key: context.ownerId },
        { type: "repository", key: context.repositoryId },
      ]);
      await client.query("INSERT INTO analysis_run_events(run_id,version,state,phase) VALUES ($1,1,'pending','pending')", [run.id]);
      await client.query(
        `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
         VALUES ($1,$2,'repository.analysis.queue','analysis_run',$3,'pending',$4,$5::jsonb)`,
        [input.actorId ?? context.ownerId, input.actorRole ?? "system", run.id, input.requestId ?? null, JSON.stringify({ repositoryId: context.repositoryId, revisionId: context.revisionId, generation })],
      );
    }
    await client.query("COMMIT");
    return { id: run.id, state: run.state, phase: run.phase, analysisGeneration: run.analysisGeneration, revisionId: run.revisionId, replayed: !run.inserted };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function requestRepositoryAnalysisCancellation(pool: Pool, input: {
  ownerId: string;
  repositoryId: string;
  reason: "visibility_revoked" | "repository_disabled" | "user_cancelled";
}) {
  const result = await pool.query<{ id: string }>(
    `WITH requested AS (
       UPDATE analysis_runs SET cancel_requested_at=COALESCE(cancel_requested_at,now()),cancel_reason=$3,version=version+1,updated_at=now()
       WHERE owner_id=$1 AND repository_id=$2 AND state IN ('pending','running') AND cancel_requested_at IS NULL
       RETURNING id,version,state,phase
     ),events AS (
       INSERT INTO analysis_run_events(run_id,version,state,phase,safe_error_code)
       SELECT id,version,state,phase,'CODE_AGENT_CANCEL_REQUESTED' FROM requested
     )
     SELECT id FROM requested`,
    [input.ownerId, input.repositoryId, input.reason],
  );
  return result.rows.map((row) => row.id);
}
