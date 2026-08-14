import { getRuntimeConfig } from "@/server/config";
import { requestPublicRepositoryAnalysisCancellation, requestRepositoryAnalysisCancellationInTransaction } from "@/server/code-agent/analysis-cancellation";
import { queueRepositoryAnalysisRun } from "@/server/code-agent/analysis-runs";
import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { enqueueRepositoryDocumentSources, invalidateRepositoryAnswers, revokeRepositoryDocumentSources } from "@/server/rag/repository-document-index";
import { enqueueApprovedWikiSourcesForOpenIndexes } from "@/server/rag/index-coordinator";

import { FileSystemRepositoryArtifactStore } from "./artifact-store";
import type { RepositoryResyncInput, RepositorySyncInput } from "./repository-input";
import { createPostgresRepositoryRevisionStore, synchronizeRepository, type RepositoryVisibility } from "./repository-sync";

export type CandidateRepository = {
  id: string;
  canonicalUrl: string;
  displayName: string;
  visibility: RepositoryVisibility;
  publicDeepAnalysisEnabled: boolean;
  disabledAt: string | null;
  latestRevision: null | {
    id: string;
    requestedRef: string;
    commitSha: string;
    state: "staging" | "stored" | "failed" | "collected";
    errorCode: string | null;
    fileCount: number;
    extractedBytes: number;
    createdAt: string;
  };
  activeRevision: null | { id: string; commitSha: string };
  activeProjectionId: string | null;
  ragIndexState: "not_indexed" | "indexing" | "ready" | "ready_with_warnings" | "failed" | "stale";
  ragIndexCommitSha: string | null;
  ragIndexedFileCount: number;
  ragSkippedFileCount: number;
  ragIndexWarnings: string[];
  ragIndexErrorCode: string | null;
  latestAnalysisRun: null | {
    id: string;
    state: "pending" | "running" | "completed" | "failed" | "cancelled";
    phase: string;
    analysisGeneration: number;
    safeErrorCode: string | null;
    createdAt: string;
    finishedAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
};

export async function listCandidateRepositories(ownerId: string) {
  const result = await getPool().query<CandidateRepository>(
    `SELECT repository.id,repository.canonical_url AS "canonicalUrl",repository.display_name AS "displayName",
            repository.visibility,repository.public_deep_analysis_enabled AS "publicDeepAnalysisEnabled",
            repository.disabled_at AS "disabledAt",repository.active_projection_id AS "activeProjectionId",
            repository.rag_index_state AS "ragIndexState",repository.rag_index_commit_sha AS "ragIndexCommitSha",
            repository.rag_indexed_file_count AS "ragIndexedFileCount",repository.rag_skipped_file_count AS "ragSkippedFileCount",
            repository.rag_index_warnings AS "ragIndexWarnings",repository.rag_index_error_code AS "ragIndexErrorCode",
            repository.created_at AS "createdAt",repository.updated_at AS "updatedAt",
            CASE WHEN latest.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id',latest.id,'requestedRef',latest.requested_ref,'commitSha',latest.commit_sha,'state',latest.state,
              'errorCode',latest.error_code,'fileCount',latest.file_count,'extractedBytes',latest.extracted_bytes,'createdAt',latest.created_at
            ) END AS "latestRevision",
            CASE WHEN active.id IS NULL THEN NULL ELSE jsonb_build_object('id',active.id,'commitSha',active.commit_sha) END AS "activeRevision"
            ,CASE WHEN analysis.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id',analysis.id,'state',analysis.state,'phase',analysis.phase,'analysisGeneration',analysis.analysis_generation,
              'safeErrorCode',analysis.safe_error_code,'createdAt',analysis.created_at,'finishedAt',analysis.finished_at
            ) END AS "latestAnalysisRun"
     FROM repositories repository
     LEFT JOIN LATERAL (
       SELECT revision.* FROM repository_revisions revision
       WHERE revision.repository_id=repository.id AND revision.owner_id=repository.owner_id
       ORDER BY revision.created_at DESC,revision.id DESC LIMIT 1
     ) latest ON true
     LEFT JOIN repository_revisions active ON active.id=repository.active_revision_id AND active.owner_id=repository.owner_id
     LEFT JOIN LATERAL (
       SELECT run.* FROM analysis_runs run
       WHERE run.repository_id=repository.id AND run.owner_id=repository.owner_id AND run.purpose='repository_analysis'
       ORDER BY run.created_at DESC,run.id DESC LIMIT 1
     ) analysis ON true
     WHERE repository.owner_id=$1
     ORDER BY repository.updated_at DESC,repository.id DESC`,
    [ownerId],
  );
  return { items: result.rows };
}

async function runSync(ownerId: string, input: RepositorySyncInput, requestId?: string) {
  const config = getRuntimeConfig();
  const pool = getPool();
  const result = await synchronizeRepository(ownerId, { ...input, requestId }, {
    artifactStore: new FileSystemRepositoryArtifactStore(config.repositoryArtifactRoot),
    revisionStore: createPostgresRepositoryRevisionStore(pool),
  });
  const current = await pool.query<CandidateRepository>(
    `SELECT repository.id,repository.canonical_url AS "canonicalUrl",repository.display_name AS "displayName",repository.visibility,
            repository.public_deep_analysis_enabled AS "publicDeepAnalysisEnabled",repository.disabled_at AS "disabledAt",
            repository.active_projection_id AS "activeProjectionId",repository.rag_index_state AS "ragIndexState",repository.rag_index_commit_sha AS "ragIndexCommitSha",
            repository.rag_indexed_file_count AS "ragIndexedFileCount",repository.rag_skipped_file_count AS "ragSkippedFileCount",
            repository.rag_index_warnings AS "ragIndexWarnings",repository.rag_index_error_code AS "ragIndexErrorCode",repository.created_at AS "createdAt",repository.updated_at AS "updatedAt",
            jsonb_build_object('id',revision.id,'requestedRef',revision.requested_ref,'commitSha',revision.commit_sha,'state',revision.state,
              'errorCode',revision.error_code,'fileCount',revision.file_count,'extractedBytes',revision.extracted_bytes,'createdAt',revision.created_at) AS "latestRevision",
            NULL::jsonb AS "activeRevision"
     FROM repositories repository JOIN repository_revisions revision ON revision.id=$3 AND revision.owner_id=repository.owner_id
     WHERE repository.id=$2 AND repository.owner_id=$1`,
    [ownerId, result.repositoryId, result.revisionId],
  );
  const repository = current.rows[0]!;
  if (input.visibility === "private") return { ...repository, analysisRun: null };
  try {
    const analysisRun = await queueRepositoryAnalysisRun({
      pool,
      config,
      ownerId,
      repositoryId: result.repositoryId,
      revisionId: result.revisionId,
      actorRole: "candidate",
      requestId,
    });
    return { ...repository, analysisRun };
  } catch (error) {
    if (error instanceof AppError) {
      return { ...repository, analysisRun: { state: "unavailable" as const, errorCode: error.code } };
    }
    throw error;
  }
}

export async function createAndSyncCandidateRepository(ownerId: string, input: RepositorySyncInput, requestId?: string) {
  return runSync(ownerId, input, requestId);
}

export async function resyncCandidateRepository(ownerId: string, repositoryId: string, input: RepositoryResyncInput, requestId?: string) {
  const repository = await getPool().query<{ canonicalUrl: string; visibility: RepositoryVisibility }>(
    `SELECT canonical_url AS "canonicalUrl",visibility FROM repositories WHERE id=$1 AND owner_id=$2 AND disabled_at IS NULL`,
    [repositoryId, ownerId],
  );
  const current = repository.rows[0];
  if (!current) throw new AppError("REPOSITORY_NOT_FOUND", "The Repository was not found.", 404);
  return runSync(ownerId, { repositoryUrl: current.canonicalUrl, visibility: current.visibility, ...input }, requestId);
}

export async function updateCandidateRepositoryVisibility(ownerId: string, repositoryId: string, visibility: RepositoryVisibility, requestId?: string) {
  const client = await getPool().connect();
  let updatedRepository: { id: string; visibility: RepositoryVisibility; publicDeepAnalysisEnabled: boolean } | undefined;
  let previousVisibility: RepositoryVisibility | undefined;
  try {
    await client.query("BEGIN");
    const previous = await client.query<{ visibility: RepositoryVisibility }>(
      "SELECT visibility FROM repositories WHERE id=$1 AND owner_id=$2 AND disabled_at IS NULL FOR UPDATE",
      [repositoryId, ownerId],
    );
    previousVisibility = previous.rows[0]?.visibility;
    if (!previousVisibility) throw new AppError("REPOSITORY_NOT_FOUND", "The Repository was not found.", 404);
    const updated = await client.query<{ id: string; visibility: RepositoryVisibility; publicDeepAnalysisEnabled: boolean }>(
      `UPDATE repositories SET
         visibility=$3::visibility,
         public_deep_analysis_enabled=CASE WHEN $3::visibility IN ('citation_allowed'::visibility,'public_preview'::visibility) THEN public_deep_analysis_enabled ELSE false END,
         updated_at=now()
       WHERE id=$1 AND owner_id=$2 AND disabled_at IS NULL
       RETURNING id,visibility,public_deep_analysis_enabled AS "publicDeepAnalysisEnabled"`,
      [repositoryId, ownerId, visibility],
    );
    updatedRepository = updated.rows[0];
    if (!updatedRepository) throw new AppError("REPOSITORY_NOT_FOUND", "The Repository was not found.", 404);
    if (visibility === "private" || visibility === "agent_only") {
      await invalidateRepositoryAnswers(client, ownerId, repositoryId, visibility);
    }
    if (visibility === "private") {
      await requestRepositoryAnalysisCancellationInTransaction(client, ownerId, repositoryId, "visibility_revoked");
      await revokeRepositoryDocumentSources(client, ownerId, repositoryId);
    }
    else if (visibility === "agent_only" && previousVisibility !== "agent_only") await requestPublicRepositoryAnalysisCancellation(client, ownerId, repositoryId, "visibility_revoked");
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','repository.visibility.update','repository',$2,'updated',$3,$4::jsonb)`,
      [ownerId, repositoryId, requestId ?? null, JSON.stringify({ visibility })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (visibility === "private") return { ...updatedRepository, analysisRun: null };
  const config = getRuntimeConfig();
  const [ragIndex, wikiIndexVersions] = await Promise.all([
    enqueueRepositoryDocumentSources(getPool(), config, ownerId, repositoryId),
    enqueueApprovedWikiSourcesForOpenIndexes(getPool(), ownerId, repositoryId),
  ]);
  const latest = await getPool().query<{ revisionId: string }>(
    `SELECT id AS "revisionId" FROM repository_revisions
     WHERE repository_id=$1 AND owner_id=$2 AND state='stored'
     ORDER BY created_at DESC,id DESC LIMIT 1`,
    [repositoryId, ownerId],
  );
  const revisionId = latest.rows[0]?.revisionId;
  if (!revisionId) return { ...updatedRepository, ragIndex, wikiIndexVersions, analysisRun: null };
  try {
    const analysisRun = await queueRepositoryAnalysisRun({
      pool: getPool(), config, ownerId, repositoryId, revisionId, actorRole: "candidate", requestId,
      forceNewGeneration: previousVisibility === "private",
    });
    return { ...updatedRepository, ragIndex, wikiIndexVersions, analysisRun };
  } catch (error) {
    if (error instanceof AppError) {
      return { ...updatedRepository, ragIndex, wikiIndexVersions, analysisRun: { state: "unavailable" as const, errorCode: error.code } };
    }
    throw error;
  }
}

export async function updateCandidateRepositoryPublicDeepAnalysis(ownerId: string, repositoryId: string, enabled: boolean, requestId?: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query<{ id: string; visibility: RepositoryVisibility; publicDeepAnalysisEnabled: boolean }>(
      `UPDATE repositories SET public_deep_analysis_enabled=$3,updated_at=now()
       WHERE id=$1 AND owner_id=$2 AND disabled_at IS NULL AND visibility IN ('citation_allowed','public_preview')
       RETURNING id,visibility,public_deep_analysis_enabled AS "publicDeepAnalysisEnabled"`,
      [repositoryId, ownerId, enabled],
    );
    const repository = updated.rows[0];
    if (!repository) throw new AppError("REPOSITORY_PUBLIC_DEEP_NOT_ALLOWED", "Public deep analysis requires a public-answer Repository visibility.", 409);
    if (!enabled) {
      await requestPublicRepositoryAnalysisCancellation(client, ownerId, repositoryId, "public_deep_disabled");
    }
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','repository.public_deep.update','repository',$2,'updated',$3,$4::jsonb)`,
      [ownerId, repositoryId, requestId ?? null, JSON.stringify({ enabled })],
    );
    await client.query("COMMIT");
    return repository;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function rerunCandidateRepositoryAnalysis(ownerId: string, repositoryId: string, requestId?: string) {
  const config = getRuntimeConfig();
  return queueRepositoryAnalysisRun({
    pool: getPool(),
    config,
    ownerId,
    repositoryId,
    explicitRerun: true,
    actorRole: "candidate",
    requestId,
  });
}
