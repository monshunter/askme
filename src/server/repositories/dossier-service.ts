import type { Pool, PoolClient } from "pg";

import { AppError } from "@/server/errors";

import { readRepositoryArtifactEvidence, type RepositoryArtifactDescriptor } from "./artifact-reader";
import { parseRepositoryDossierOutput, validateRepositoryDossierOutput, type ValidatedRepositoryDossier } from "./dossier-output";
import type { RepositoryVisibility } from "./repository-sync";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;
type AnalysisRunContext = RepositoryArtifactDescriptor & {
  runId: string;
  ownerId: string;
  purpose: "repository_analysis" | "conversation_analysis";
  repositoryId: string;
  revisionId: string;
  analysisGeneration: number;
  runState: "pending" | "running" | "completed" | "failed" | "cancelled";
  version: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  cancelRequestedAt: Date | null;
  imageDigest: string;
  skillHash: string;
  promptVersion: string;
  profileFingerprint: string;
  configuredModel: string;
  repositoryVisibility: RepositoryVisibility;
  repositoryDisabledAt: Date | null;
  revisionState: "staging" | "stored" | "failed" | "collected";
};

export type RepositoryDossierCompletion = {
  dossierId: string;
  generatedVersion: number;
  runVersion: number;
  replayed: boolean;
};

async function queryRunContext(queryable: Queryable, runId: string, forUpdate = false) {
  const result = await queryable.query<AnalysisRunContext>(
    `SELECT run.id AS "runId",run.owner_id AS "ownerId",run.purpose,run.repository_id AS "repositoryId",run.revision_id AS "revisionId",
            run.analysis_generation AS "analysisGeneration",run.state AS "runState",run.version,run.lease_owner AS "leaseOwner",
            run.lease_expires_at AS "leaseExpiresAt",run.cancel_requested_at AS "cancelRequestedAt",run.image_digest AS "imageDigest",
            run.skill_hash AS "skillHash",run.prompt_version AS "promptVersion",run.profile_fingerprint AS "profileFingerprint",
            run.configured_model AS "configuredModel",repository.visibility AS "repositoryVisibility",repository.disabled_at AS "repositoryDisabledAt",
            repository.canonical_url AS "canonicalUrl",revision.commit_sha AS "commitSha",revision.filter_fingerprint AS "filterFingerprint",
            revision.state AS "revisionState",artifact.content_key AS "contentKey",artifact.checksum,artifact.manifest_checksum AS "manifestChecksum",
            artifact.storage_path AS "storagePath",artifact.file_count AS "fileCount"
     FROM analysis_runs run
     JOIN repositories repository ON repository.id=run.repository_id AND repository.owner_id=run.owner_id
     JOIN repository_revisions revision ON revision.id=run.revision_id AND revision.repository_id=repository.id AND revision.owner_id=run.owner_id
     JOIN repository_artifacts artifact ON artifact.content_key=revision.artifact_key
     WHERE run.id=$1
     ${forUpdate ? "FOR UPDATE OF run,repository,revision,artifact" : ""}`,
    [runId],
  );
  const context = result.rows[0];
  if (!context) throw new AppError("REPOSITORY_ANALYSIS_RUN_NOT_FOUND", "The Repository Analysis Run was not found.", 404);
  return context;
}

async function existingDossier(queryable: Queryable, runId: string) {
  const result = await queryable.query<{ dossierId: string; generatedVersion: number; runVersion: number }>(
    `SELECT dossier.id AS "dossierId",dossier.generated_version AS "generatedVersion",run.version AS "runVersion"
     FROM repository_dossiers dossier JOIN analysis_runs run ON run.id=dossier.analysis_run_id
     WHERE dossier.analysis_run_id=$1`,
    [runId],
  );
  return result.rows[0] ?? null;
}

function requireCompletableContext(context: AnalysisRunContext, leaseOwner: string) {
  if (context.purpose !== "repository_analysis") throw new AppError("REPOSITORY_ANALYSIS_PURPOSE_INVALID", "The Analysis Run is not a Repository Dossier run.", 409);
  if (context.runState !== "running" || context.leaseOwner !== leaseOwner || !context.leaseExpiresAt || context.leaseExpiresAt.getTime() <= Date.now()) {
    throw new AppError("REPOSITORY_ANALYSIS_LEASE_INVALID", "The Repository Analysis lease is no longer valid.", 409);
  }
  if (context.cancelRequestedAt) throw new AppError("REPOSITORY_ANALYSIS_CANCELLED", "The Repository Analysis Run was cancelled.", 409);
  if (context.repositoryDisabledAt) throw new AppError("REPOSITORY_DISABLED", "The Repository is disabled.", 409);
  if (context.repositoryVisibility === "private") throw new AppError("DOSSIER_REPOSITORY_PRIVATE", "A private Repository cannot generate a Dossier.", 409);
  if (context.revisionState !== "stored") throw new AppError("REPOSITORY_REVISION_NOT_STORED", "The Repository Revision is not available for analysis.", 409);
}

function requireSafeUsage(usage: Record<string, number>) {
  const entries = Object.entries(usage);
  if (entries.length > 32 || Buffer.byteLength(JSON.stringify(usage), "utf8") > 16 * 1024) {
    throw new AppError("REPOSITORY_ANALYSIS_USAGE_INVALID", "The Repository Analysis usage metadata is invalid.", 422);
  }
  for (const [key, value] of entries) {
    if (!/^[a-z][a-zA-Z0-9]{0,63}$/.test(key) || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value)) {
      throw new AppError("REPOSITORY_ANALYSIS_USAGE_INVALID", "The Repository Analysis usage metadata is invalid.", 422);
    }
  }
}

function sameArtifact(left: AnalysisRunContext, right: AnalysisRunContext) {
  return left.repositoryId === right.repositoryId
    && left.revisionId === right.revisionId
    && left.contentKey === right.contentKey
    && left.checksum === right.checksum
    && left.manifestChecksum === right.manifestChecksum
    && left.storagePath === right.storagePath
    && left.commitSha === right.commitSha
    && left.filterFingerprint === right.filterFingerprint;
}

async function insertDossier(client: PoolClient, context: AnalysisRunContext, output: ValidatedRepositoryDossier, actualModel: string) {
  const generatedVersion = context.analysisGeneration + 1;
  const dossier = await client.query<{ id: string }>(
    `INSERT INTO repository_dossiers(
       repository_id,revision_id,owner_id,analysis_run_id,generated_version,analysis_generation,state,coverage,
       image_digest,skill_hash,prompt_version,profile_fingerprint,configured_model,actual_model,wiki_title,wiki_summary,wiki_manifest
     ) VALUES ($1,$2,$3,$4,$5,$6,'review_pending',$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
     RETURNING id`,
    [
      context.repositoryId, context.revisionId, context.ownerId, context.runId, generatedVersion, context.analysisGeneration,
      JSON.stringify(output.coverage), context.imageDigest, context.skillHash, context.promptVersion, context.profileFingerprint,
      context.configuredModel, actualModel, output.title, output.summary,
      JSON.stringify({ pages: output.pages.map(({ path, title, order }) => ({ path, title, order })) }),
    ],
  );
  const dossierId = dossier.rows[0]?.id;
  if (!dossierId) throw new AppError("REPOSITORY_DOSSIER_WRITE_FAILED", "The generated Repository Dossier could not be stored.", 500);
  const pageIds = new Map<string, string>();
  for (const page of output.pages) {
    const pageResult = await client.query<{ id: string }>(
      `INSERT INTO repository_wiki_pages(dossier_id,path,title,generated_markdown,sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [dossierId, page.path, page.title, page.markdown, page.order],
    );
    const pageId = pageResult.rows[0]?.id;
    if (!pageId) throw new AppError("REPOSITORY_DOSSIER_WRITE_FAILED", "A generated Repository Wiki page could not be stored.", 500);
    pageIds.set(page.path, pageId);
  }
  for (const [index, citation] of output.citations.entries()) {
    const pageId = pageIds.get(citation.pagePath);
    if (!pageId) throw new AppError("REPOSITORY_DOSSIER_WRITE_FAILED", "A Repository Wiki Citation has no generated page.", 500);
    await client.query(
      `INSERT INTO repository_wiki_citations(dossier_id,page_id,revision_id,marker,rank,path,line_start,line_end,content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [dossierId, pageId, context.revisionId, citation.marker, index + 1, citation.path, citation.lineStart, citation.lineEnd, citation.contentHash],
    );
  }
  return { dossierId, generatedVersion };
}

export async function completeRepositoryAnalysisRun(input: {
  pool: Pool;
  artifactRoot: string;
  runId: string;
  leaseOwner: string;
  output: unknown;
  wikiFiles: ReadonlyMap<string, string>;
  actualModel: string;
  usage: Record<string, number>;
  cleanupCompletedAt: Date;
}): Promise<RepositoryDossierCompletion> {
  if (!input.leaseOwner || input.leaseOwner.length > 200) throw new AppError("REPOSITORY_ANALYSIS_LEASE_INVALID", "The Repository Analysis lease is invalid.", 409);
  if (!input.actualModel.trim() || input.actualModel.length > 300) throw new AppError("REPOSITORY_ANALYSIS_MODEL_INVALID", "The Repository Analysis model provenance is invalid.", 422);
  if (!Number.isFinite(input.cleanupCompletedAt.getTime()) || input.cleanupCompletedAt.getTime() > Date.now() + 5_000) {
    throw new AppError("REPOSITORY_ANALYSIS_CLEANUP_INVALID", "The Repository Analysis cleanup timestamp is invalid.", 422);
  }
  requireSafeUsage(input.usage);
  const replay = await existingDossier(input.pool, input.runId);
  if (replay) return { ...replay, replayed: true };
  const initial = await queryRunContext(input.pool, input.runId);
  requireCompletableContext(initial, input.leaseOwner);
  const parsed = parseRepositoryDossierOutput(input.output);
  const evidence = await readRepositoryArtifactEvidence(input.artifactRoot, initial, parsed.coverage.examinedPaths);
  validateRepositoryDossierOutput(parsed, input.wikiFiles, evidence, initial.repositoryVisibility);

  const client = await input.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [initial.revisionId]);
    const current = await queryRunContext(client, input.runId, true);
    requireCompletableContext(current, input.leaseOwner);
    if (!sameArtifact(initial, current)) throw new AppError("REPOSITORY_ANALYSIS_CONTEXT_CHANGED", "The Repository Analysis context changed before completion.", 409);
    const finalValidated = validateRepositoryDossierOutput(parsed, input.wikiFiles, evidence, current.repositoryVisibility);
    const inserted = await insertDossier(client, current, finalValidated, input.actualModel.trim());
    const run = await client.query<{ version: number }>(
      `UPDATE analysis_runs SET state='completed',outcome='answered',version=version+1,phase='review_pending',lease_owner=NULL,lease_expires_at=NULL,
         usage=$3::jsonb,actual_model=$4,finished_at=now(),cleanup_completed_at=$5,updated_at=now()
       WHERE id=$1 AND lease_owner=$2 AND state='running' AND cancel_requested_at IS NULL
       RETURNING version`,
      [input.runId, input.leaseOwner, JSON.stringify(input.usage), input.actualModel.trim(), input.cleanupCompletedAt],
    );
    const runVersion = run.rows[0]?.version;
    if (!runVersion) throw new AppError("REPOSITORY_ANALYSIS_LEASE_INVALID", "The Repository Analysis lease is no longer valid.", 409);
    await client.query(
      `INSERT INTO analysis_run_events(run_id,version,state,phase) VALUES ($1,$2,'completed','review_pending')`,
      [input.runId, runVersion],
    );
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,metadata)
       VALUES ($1,'system','repository.dossier.generate','repository_dossier',$2,'review_pending',$3::jsonb)`,
      [current.ownerId, inserted.dossierId, JSON.stringify({ runId: input.runId, repositoryId: current.repositoryId, revisionId: current.revisionId, generatedVersion: inserted.generatedVersion })],
    );
    await client.query("COMMIT");
    return { ...inserted, runVersion, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof AppError) throw error;
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (code === "23505") {
      const existing = await existingDossier(input.pool, input.runId);
      if (existing) return { ...existing, replayed: true };
    }
    throw error;
  } finally {
    client.release();
  }
}
