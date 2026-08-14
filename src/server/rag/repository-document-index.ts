import type { Pool } from "pg";

import type { RuntimeConfig } from "@/server/config";
import { toAppError } from "@/server/errors";
import { collectRepositoryDocuments } from "@/server/repositories/repository-document-collector";
import type { RepositoryArtifactDescriptor } from "@/server/repositories/artifact-reader";

type RepositoryArtifactRow = RepositoryArtifactDescriptor & { repositoryId: string; ownerId: string; displayName: string; visibility: string; revisionId: string };

async function repositoryArtifact(pool: Pool, ownerId: string, repositoryId: string) {
  const result = await pool.query<RepositoryArtifactRow>(
    `SELECT repository.id AS "repositoryId",repository.owner_id AS "ownerId",repository.display_name AS "displayName",repository.visibility,
            revision.id AS "revisionId",revision.commit_sha AS "commitSha",revision.filter_fingerprint AS "filterFingerprint",
            artifact.content_key AS "contentKey",artifact.checksum,artifact.manifest_checksum AS "manifestChecksum",artifact.storage_path AS "storagePath",
            repository.canonical_url AS "canonicalUrl",artifact.file_count AS "fileCount"
     FROM repositories repository
     JOIN repository_revisions revision ON revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id AND revision.state='stored'
     JOIN repository_artifacts artifact ON artifact.content_key=revision.artifact_key
     WHERE repository.id=$1 AND repository.owner_id=$2 AND repository.disabled_at IS NULL`,
    [repositoryId, ownerId],
  );
  return result.rows[0] ?? null;
}

export async function enqueueRepositoryDocumentSources(pool: Pool, config: RuntimeConfig, ownerId: string, repositoryId: string) {
  const descriptor = await repositoryArtifact(pool, ownerId, repositoryId);
  if (!descriptor) return { state: "not_indexed" as const, indexedFileCount: 0, skippedFileCount: 0, warnings: [] as string[] };
  try {
    const collected = await collectRepositoryDocuments(config.repositoryArtifactRoot, descriptor, config.rag.repositoryDocuments);
    const warnings = collected.skipped.filter((entry) => entry.reason !== "not_included" && entry.reason !== "excluded").map((entry) => `${entry.path}:${entry.reason}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [repositoryId]);
      await client.query(
        `UPDATE rag_source_versions source SET state='revoked',revoked_at=now(),lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
         WHERE source.owner_id=$1 AND source.source_kind IN ('repository_markdown','repository_pdf')
           AND source.metadata->>'repositoryId'=$2 AND source.metadata->>'commitSha'<>$3
           AND source.state IN ('queued','processing','ready','ready_with_warnings','active')`,
        [ownerId, repositoryId, descriptor.commitSha],
      );
      let inserted = 0;
      for (const document of collected.documents) {
        const result = await client.query(
          `WITH inserted AS (
             INSERT INTO rag_source_versions(owner_id,source_kind,source_id,source_revision,index_version_id,state,visibility,evidence_family_id,metadata,warning_codes)
             SELECT $1,$2::rag_source_kind,$3::uuid,$4,version.id,'queued',$5::visibility,
                    encode(digest('repository-document:' || $3::text || ':' || $6,'sha256'),'hex'),$7::jsonb,'[]'::jsonb
             FROM rag_index_versions version WHERE version.state IN ('building','ready','active')
             ON CONFLICT(index_version_id,owner_id,source_kind,source_id,source_revision) DO UPDATE SET
               state='queued',visibility=EXCLUDED.visibility,evidence_family_id=EXCLUDED.evidence_family_id,metadata=EXCLUDED.metadata,
               warning_codes=EXCLUDED.warning_codes,parent_count=0,child_count=0,token_count=0,failure_code=NULL,
               lease_owner=NULL,lease_expires_at=NULL,activated_at=NULL,superseded_at=NULL,revoked_at=NULL,updated_at=now()
             WHERE rag_source_versions.state IN ('revoked','superseded','failed')
             RETURNING index_version_id
           ), updated AS (
             UPDATE rag_index_versions version SET expected_source_count=expected_source_count+counts.added,
               state=CASE WHEN version.state='ready' THEN 'building'::rag_index_state ELSE version.state END,updated_at=now()
             FROM (SELECT index_version_id,count(*)::integer AS added FROM inserted GROUP BY index_version_id) counts
             WHERE version.id=counts.index_version_id AND version.state IN ('building','ready')
           ) SELECT count(*)::integer AS count FROM inserted`,
          [ownerId, document.kind, repositoryId, document.sourceRevision, descriptor.visibility, document.path, JSON.stringify({ repositoryId, repositoryTitle: descriptor.displayName, revisionId: descriptor.revisionId, commitSha: descriptor.commitSha, path: document.path, contentHash: document.contentHash, pageCount: document.pageCount })],
        );
        inserted += Number(result.rows[0]?.count ?? 0);
      }
      const state = collected.documents.length === 0 ? (warnings.length > 0 ? "ready_with_warnings" : "ready") : "indexing";
      await client.query(
        `UPDATE repositories SET rag_index_state=$3,rag_index_commit_sha=$4,rag_indexed_file_count=0,rag_skipped_file_count=$5,
                rag_index_warnings=$6::jsonb,rag_index_error_code=NULL,updated_at=now()
         WHERE id=$1 AND owner_id=$2`,
        [repositoryId, ownerId, state, descriptor.commitSha, warnings.length, JSON.stringify(warnings)],
      );
      await client.query("COMMIT");
      await reconcileRepositoryDocumentIndex(pool, ownerId, repositoryId, descriptor.commitSha);
      return { state, indexedFileCount: 0, skippedFileCount: warnings.length, warnings, queuedSourceCount: inserted };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const safe = toAppError(error);
    await pool.query(
      `UPDATE repositories SET rag_index_state='failed',rag_index_commit_sha=$3,rag_index_error_code=$4,updated_at=now()
       WHERE id=$1 AND owner_id=$2`,
      [repositoryId, ownerId, descriptor.commitSha, safe.code],
    );
    return { state: "failed" as const, indexedFileCount: 0, skippedFileCount: 0, warnings: [] as string[], errorCode: safe.code };
  }
}

export async function reconcileRepositoryDocumentIndex(pool: Pool, ownerId: string, repositoryId: string, commitSha: string) {
  await pool.query(
    `UPDATE repositories repository SET
       rag_index_state=CASE
         WHEN EXISTS (SELECT 1 FROM rag_source_versions source WHERE source.owner_id=$1 AND source.source_kind IN ('repository_markdown','repository_pdf') AND source.metadata->>'repositoryId'=$2::text AND source.metadata->>'commitSha'=$3 AND source.state='failed') THEN 'failed'
         WHEN EXISTS (SELECT 1 FROM rag_source_versions source WHERE source.owner_id=$1 AND source.source_kind IN ('repository_markdown','repository_pdf') AND source.metadata->>'repositoryId'=$2::text AND source.metadata->>'commitSha'=$3 AND source.state IN ('queued','processing')) THEN 'indexing'
         WHEN jsonb_array_length(repository.rag_index_warnings)>0 THEN 'ready_with_warnings'
         ELSE 'ready' END,
       rag_indexed_file_count=(SELECT count(*)::integer FROM rag_source_versions source WHERE source.owner_id=$1 AND source.source_kind IN ('repository_markdown','repository_pdf') AND source.metadata->>'repositoryId'=$2::text AND source.metadata->>'commitSha'=$3 AND source.state IN ('ready','ready_with_warnings','active')),
       rag_index_error_code=CASE WHEN EXISTS (SELECT 1 FROM rag_source_versions source WHERE source.owner_id=$1 AND source.source_kind IN ('repository_markdown','repository_pdf') AND source.metadata->>'repositoryId'=$2::text AND source.metadata->>'commitSha'=$3 AND source.state='failed') THEN 'REPOSITORY_DOCUMENT_INDEX_FAILED' ELSE NULL END,
       updated_at=now()
     WHERE repository.id=$2::uuid AND repository.owner_id=$1 AND repository.rag_index_commit_sha=$3`,
    [ownerId, repositoryId, commitSha],
  );
}

export async function invalidateRepositoryAnswers(
  queryable: Pick<Pool, "query">,
  ownerId: string,
  repositoryId: string,
  visibility: "private" | "agent_only",
) {
  await queryable.query(
    `UPDATE messages message
     SET source_invalidated_at=coalesce(message.source_invalidated_at,now())
     FROM conversations conversation
     WHERE message.conversation_id=conversation.id AND message.owner_id=$1 AND conversation.owner_id=$1
       AND message.role='assistant' AND ($3::conversation_mode IS NULL OR conversation.mode=$3::conversation_mode)
       AND (
         EXISTS (
           SELECT 1 FROM repository_message_citations citation
           WHERE citation.message_id=message.id AND citation.owner_id=$1 AND citation.repository_id=$2::uuid
         )
         OR EXISTS (
           SELECT 1 FROM rag_message_citations citation
           JOIN rag_source_versions source ON source.id=citation.source_version_id AND source.owner_id=citation.owner_id
           WHERE citation.message_id=message.id AND citation.owner_id=$1
             AND citation.source_kind IN ('approved_wiki','repository_markdown','repository_pdf')
             AND coalesce(source.metadata->>'repositoryId',citation.source_id::text)=$2::text
         )
       )`,
    [ownerId, repositoryId, visibility === "agent_only" ? "public" : null],
  );
}

export async function revokeRepositoryDocumentSources(queryable: Pick<Pool, "query">, ownerId: string, repositoryId: string) {
  await queryable.query(
    `UPDATE rag_source_versions SET state='revoked',revoked_at=now(),lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
     WHERE owner_id=$1 AND source_kind IN ('approved_wiki','repository_markdown','repository_pdf') AND metadata->>'repositoryId'=$2
       AND state IN ('queued','processing','ready','ready_with_warnings','active')`,
    [ownerId, repositoryId],
  );
  await queryable.query(
    `UPDATE repositories SET rag_index_state='not_indexed',rag_index_error_code=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2`,
    [repositoryId, ownerId],
  );
}
