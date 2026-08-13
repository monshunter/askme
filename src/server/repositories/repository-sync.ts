import { createHash } from "node:crypto";

import type { Pool } from "pg";

import { fetchGitHubRevision, type GitHubFetch } from "./github-adapter";

export type RepositoryVisibility = "private" | "agent_only" | "citation_allowed" | "public_preview";

export type StoredRepositoryArtifact = {
  contentKey: string;
  checksum: string;
  manifestChecksum: string;
  storagePath: string;
  compressedBytes: number;
  extractedBytes: number;
  fileCount: number;
  filterFingerprint: string;
  excludePatterns: string[];
  ensureStored?: () => Promise<void>;
};

export type RepositoryArtifactStore = {
  store(input: {
    ownerId: string;
    canonicalUrl: string;
    commitSha: string;
    archive: Uint8Array;
    archiveChecksum: string;
    excludePatterns: string[];
  }): Promise<StoredRepositoryArtifact>;
};

type FetchedRevisionCommit = {
  canonicalUrl: string;
  displayName: string;
  requestedRef: string;
  commitSha: string;
  archiveChecksum: string;
  archiveBytes: number;
  visibility: RepositoryVisibility;
  artifact: StoredRepositoryArtifact;
  requestId?: string;
};

type RevisionCommitResult = {
  repositoryId: string;
  revisionId: string;
  activeRevisionId: string | null;
  activeProjectionId?: string | null;
};

export type RepositoryRevisionStore = {
  commit(ownerId: string, input: FetchedRevisionCommit): Promise<RevisionCommitResult>;
};

export function createPostgresRepositoryRevisionStore(pool: Pool): RepositoryRevisionStore {
  return {
    async commit(ownerId, input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [input.artifact.contentKey]);
        await client.query(
          `INSERT INTO repository_artifacts(
             content_key,checksum,manifest_checksum,storage_path,compressed_bytes,extracted_bytes,file_count,reference_count
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,0)
           ON CONFLICT(content_key) DO UPDATE SET
             checksum=EXCLUDED.checksum,
             storage_path=EXCLUDED.storage_path,
             compressed_bytes=EXCLUDED.compressed_bytes,
             extracted_bytes=EXCLUDED.extracted_bytes,
             file_count=EXCLUDED.file_count,
             gc_eligible_at=NULL,
             gc_lease_owner=NULL,
             gc_lease_expires_at=NULL,
             gc_error_code=NULL
           WHERE repository_artifacts.checksum=EXCLUDED.checksum
             AND repository_artifacts.manifest_checksum=EXCLUDED.manifest_checksum`,
          [
            input.artifact.contentKey,
            input.artifact.checksum,
            input.artifact.manifestChecksum,
            input.artifact.storagePath,
            input.artifact.compressedBytes,
            input.artifact.extractedBytes,
            input.artifact.fileCount,
          ],
        );
        const repositoryResult = await client.query<{
          id: string;
          activeRevisionId: string | null;
          activeProjectionId: string | null;
        }>(
          `INSERT INTO repositories(owner_id,provider,canonical_url,display_name,visibility)
           VALUES ($1,'github',$2,$3,$4)
           ON CONFLICT(owner_id,canonical_url) DO UPDATE
             SET display_name=EXCLUDED.display_name,visibility=EXCLUDED.visibility,updated_at=now()
           RETURNING id,active_revision_id AS "activeRevisionId",active_projection_id AS "activeProjectionId"`,
          [ownerId, input.canonicalUrl, input.displayName, input.visibility],
        );
        const repository = repositoryResult.rows[0]!;
        const existingRevision = await client.query<{ id: string; state: "staging" | "stored" | "failed" | "collected" }>(
          `SELECT id,state FROM repository_revisions
           WHERE repository_id=$1 AND commit_sha=$2 AND filter_fingerprint=$3
           FOR UPDATE`,
          [repository.id, input.commitSha, input.artifact.filterFingerprint],
        );
        let revisionId = existingRevision.rows[0]?.id;
        const restoresReference = !revisionId || existingRevision.rows[0]?.state === "collected";
        if (!revisionId) {
          const insertedRevision = await client.query<{ id: string }>(
            `INSERT INTO repository_revisions(
               repository_id,owner_id,requested_ref,commit_sha,archive_checksum,artifact_key,
               filter_version,filter_fingerprint,exclude_patterns,archive_bytes,extracted_bytes,file_count,state,stored_at
             ) VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8::jsonb,$9,$10,$11,'stored',now())
             RETURNING id`,
            [
              repository.id,
              ownerId,
              input.requestedRef,
              input.commitSha,
              input.archiveChecksum,
              input.artifact.contentKey,
              input.artifact.filterFingerprint,
              JSON.stringify(input.artifact.excludePatterns),
              input.archiveBytes,
              input.artifact.extractedBytes,
              input.artifact.fileCount,
            ],
          );
          revisionId = insertedRevision.rows[0]?.id;
        } else if (existingRevision.rows[0]?.state === "collected") {
          await client.query(
            `UPDATE repository_revisions SET
               requested_ref=$2,archive_checksum=$3,artifact_key=$4,exclude_patterns=$5::jsonb,
               archive_bytes=$6,extracted_bytes=$7,file_count=$8,state='stored',stored_at=now(),updated_at=now()
             WHERE id=$1`,
            [revisionId, input.requestedRef, input.archiveChecksum, input.artifact.contentKey, JSON.stringify(input.artifact.excludePatterns), input.archiveBytes, input.artifact.extractedBytes, input.artifact.fileCount],
          );
        }
        if (restoresReference) {
          await client.query("UPDATE repository_artifacts SET reference_count=reference_count+1,gc_eligible_at=NULL WHERE content_key=$1", [input.artifact.contentKey]);
        }
        if (!revisionId) throw new Error("Repository revision insert did not produce an id");
        const idempotencyKey = createHash("sha256")
          .update(`${ownerId}\0${input.canonicalUrl}\0${input.commitSha}\0${input.artifact.filterFingerprint}`)
          .digest("hex");
        await client.query(
          `INSERT INTO repository_sync_jobs(
             repository_id,revision_id,owner_id,idempotency_key,state,attempts,started_at,finished_at
           ) VALUES ($1,$2,$3,$4,'completed',1,now(),now())
           ON CONFLICT(idempotency_key) DO NOTHING`,
          [repository.id, revisionId, ownerId, idempotencyKey],
        );
        await client.query(
          `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
           VALUES ($1,'candidate','repository.sync','repository',$2,'stored',$3,$4::jsonb)`,
          [ownerId, repository.id, input.requestId ?? null, JSON.stringify({ revisionId, commitSha: input.commitSha, visibility: input.visibility })],
        );
        await client.query("COMMIT");
        return {
          repositoryId: repository.id,
          revisionId,
          activeRevisionId: repository.activeRevisionId,
          activeProjectionId: repository.activeProjectionId,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export async function synchronizeRepository(
  ownerId: string,
  input: {
    repositoryUrl: string;
    ref: string;
    token?: string;
    visibility: RepositoryVisibility;
    excludePatterns?: string[];
    requestId?: string;
  },
  dependencies: {
    fetcher?: GitHubFetch;
    artifactStore: RepositoryArtifactStore;
    revisionStore: RepositoryRevisionStore;
  },
) {
  const fetched = await fetchGitHubRevision(
    { repositoryUrl: input.repositoryUrl, ref: input.ref, token: input.token },
    { fetcher: dependencies.fetcher },
  );
  const artifact = await dependencies.artifactStore.store({
    ownerId,
    canonicalUrl: fetched.canonicalUrl,
    commitSha: fetched.commitSha,
    archive: fetched.archive,
    archiveChecksum: fetched.archiveChecksum,
    excludePatterns: input.excludePatterns ?? [],
  });
  const committed = await dependencies.revisionStore.commit(ownerId, {
    canonicalUrl: fetched.canonicalUrl,
    displayName: fetched.displayName,
    requestedRef: fetched.requestedRef,
    commitSha: fetched.commitSha,
    archiveChecksum: fetched.archiveChecksum,
    archiveBytes: fetched.archiveBytes,
    visibility: input.visibility,
    artifact,
    requestId: input.requestId,
  });
  await artifact.ensureStored?.();
  return { ...committed, commitSha: fetched.commitSha, requestedRef: fetched.requestedRef };
}
