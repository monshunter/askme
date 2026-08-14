import type { Pool } from "pg";

import { EmbeddingClient } from "@/server/ai/retrieval-providers";
import type { RuntimeConfig } from "@/server/config";
import { AppError } from "@/server/errors";
import { extractStoredMaterialText } from "@/server/materials/text-extraction";
import { collectRepositoryDocument } from "@/server/repositories/repository-document-collector";
import type { RepositoryArtifactDescriptor } from "@/server/repositories/artifact-reader";

import { markIndexVersionReady } from "./index-coordinator";
import { reconcileRepositoryDocumentIndex } from "./repository-document-index";
import { structureChunkText } from "./structure-chunker";

export type RagSourceLease = {
  sourceVersionId: string;
  ownerId: string;
  sourceKind: "material" | "approved_wiki" | "repository_markdown" | "repository_pdf";
  sourceId: string;
  sourceRevision: string;
  indexVersionId: string;
  metadata: Record<string, unknown>;
  leaseOwner: string;
  leaseExpiresAt: Date;
};

type EmbeddingProvider = Pick<EmbeddingClient, "embed">;

export async function claimNextRagSource(pool: Pool, workerId: string, leaseDurationMs = 120_000): Promise<RagSourceLease | null> {
  const leaseOwner = workerId.trim().slice(0, 200);
  if (!leaseOwner) throw new AppError("INVALID_WORKER_ID", "A worker identifier is required.", 500);
  if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 10 * 60_000) throw new AppError("INVALID_LEASE_DURATION", "The RAG source lease duration is invalid.", 500);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<Omit<RagSourceLease, "sourceVersionId" | "leaseOwner" | "leaseExpiresAt"> & { id: string }>(
      `SELECT source.id,source.owner_id AS "ownerId",source.source_kind AS "sourceKind",source.source_id AS "sourceId",
              source.source_revision AS "sourceRevision",source.index_version_id AS "indexVersionId",source.metadata
       FROM rag_source_versions source
       JOIN rag_index_versions version ON version.id=source.index_version_id AND version.state IN ('building','active')
       WHERE source.state='queued' OR (source.state='processing' AND source.lease_expires_at <= now())
       ORDER BY source.created_at,source.id
       FOR UPDATE OF source SKIP LOCKED LIMIT 1`,
    );
    const row = selected.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }
    const leased = await client.query<{ leaseExpiresAt: Date }>(
      `UPDATE rag_source_versions
       SET state='processing',lease_owner=$2,lease_expires_at=now()+($3::integer*interval '1 millisecond'),failure_code=NULL,updated_at=now()
       WHERE id=$1 RETURNING lease_expires_at AS "leaseExpiresAt"`,
      [row.id, leaseOwner, leaseDurationMs],
    );
    await client.query("COMMIT");
    const leaseExpiresAt = leased.rows[0]?.leaseExpiresAt;
    if (!leaseExpiresAt) throw new AppError("RAG_SOURCE_LEASE_FAILED", "The RAG source could not be leased.", 500);
    return { sourceVersionId: row.id, ownerId: row.ownerId, sourceKind: row.sourceKind, sourceId: row.sourceId, sourceRevision: row.sourceRevision, indexVersionId: row.indexVersionId, metadata: row.metadata, leaseOwner, leaseExpiresAt };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function renewRagSourceLease(pool: Pool, lease: RagSourceLease, leaseDurationMs = 120_000) {
  const result = await pool.query<{ leaseExpiresAt: Date }>(
    `UPDATE rag_source_versions SET lease_expires_at=now()+($3::integer*interval '1 millisecond'),updated_at=now()
     WHERE id=$1 AND state='processing' AND lease_owner=$2 AND lease_expires_at>now()
     RETURNING lease_expires_at AS "leaseExpiresAt"`,
    [lease.sourceVersionId, lease.leaseOwner, leaseDurationMs],
  );
  const leaseExpiresAt = result.rows[0]?.leaseExpiresAt;
  if (!leaseExpiresAt) throw new AppError("RAG_SOURCE_LEASE_LOST", "The RAG source lease is no longer owned by this worker.", 409);
  lease.leaseExpiresAt = leaseExpiresAt;
}

export async function buildEmbeddedSource(input: { text: string; sourceRevision: string; sourceTitle: string; config: RuntimeConfig; embeddingClient: EmbeddingProvider }) {
  const chunks = structureChunkText({ text: input.text, sourceRevision: input.sourceRevision, sourceTitle: input.sourceTitle, config: input.config.rag.chunking });
  const batches = Array.from({ length: Math.ceil(chunks.children.length / input.config.embedding.batchSize) }, (_, index) => chunks.children.slice(index * input.config.embedding.batchSize, (index + 1) * input.config.embedding.batchSize));
  const embedded = new Array<number[]>(chunks.children.length);
  let inputTokens = 0;
  for (let offset = 0; offset < batches.length; offset += input.config.embedding.concurrency) {
    const group = batches.slice(offset, offset + input.config.embedding.concurrency);
    const results = await Promise.all(group.map((batch) => input.embeddingClient.embed(batch.map((child) => child.contextualContent))));
    results.forEach((result, groupIndex) => {
      const batchIndex = offset + groupIndex;
      const base = batchIndex * input.config.embedding.batchSize;
      result.vectors.forEach((vector, vectorIndex) => { embedded[base + vectorIndex] = vector; });
      inputTokens += result.inputTokens ?? 0;
    });
  }
  return { ...chunks, children: chunks.children.map((child, index) => ({ ...child, embedding: embedded[index]! })), inputTokens };
}

async function loadSourceText(pool: Pool, lease: RagSourceLease, config: RuntimeConfig) {
  if (lease.sourceKind === "material") {
    const result = await pool.query<{
      id: string; ownerId: string; title: string; kind: "file" | "notion" | "website"; originalName: string | null; storagePath: string | null; contentChecksum: string;
    }>(
      `SELECT id,owner_id AS "ownerId",title,kind,original_name AS "originalName",storage_path AS "storagePath",content_checksum AS "contentChecksum"
       FROM materials WHERE id=$1 AND owner_id=$2 AND status='indexed' AND content_checksum=$3`,
      [lease.sourceId, lease.ownerId, lease.sourceRevision],
    );
    const material = result.rows[0];
    if (!material) throw new AppError("RAG_SOURCE_REVOKED", "The Material source is no longer active.", 409);
    return { text: await extractStoredMaterialText(material, config.uploadRoot), title: material.title };
  }
  if (lease.sourceKind === "approved_wiki") {
    const result = await pool.query<{ title: string; markdown: string }>(
      `SELECT repository.display_name || ' / ' || page.title AS title,coalesce(projected.edited_markdown,page.generated_markdown) AS markdown
       FROM repository_wiki_pages page
       JOIN repository_dossiers dossier ON dossier.id=page.dossier_id
       JOIN repository_dossier_projections projection ON projection.dossier_id=dossier.id AND projection.state='approved'
       JOIN repository_wiki_projection_pages projected ON projected.projection_id=projection.id AND projected.page_id=page.id AND projected.dossier_id=dossier.id
       JOIN repositories repository ON repository.id=dossier.repository_id AND repository.owner_id=dossier.owner_id AND repository.active_projection_id=projection.id AND repository.disabled_at IS NULL
       WHERE page.id=$1 AND repository.owner_id=$2`,
      [lease.sourceId, lease.ownerId],
    );
    const page = result.rows[0];
    if (!page) throw new AppError("RAG_SOURCE_REVOKED", "The approved Wiki source is no longer active.", 409);
    return { text: page.markdown, title: page.title };
  }
  if (lease.sourceKind === "repository_markdown" || lease.sourceKind === "repository_pdf") {
    const documentPath = typeof lease.metadata.path === "string" ? lease.metadata.path : null;
    const contentHash = typeof lease.metadata.contentHash === "string" ? lease.metadata.contentHash : null;
    const commitSha = typeof lease.metadata.commitSha === "string" ? lease.metadata.commitSha : null;
    if (!documentPath || !contentHash || !commitSha) throw new AppError("RAG_SOURCE_IDENTITY_INVALID", "The Repository document identity is invalid.", 500);
    const result = await pool.query<RepositoryArtifactDescriptor & { repositoryTitle: string }>(
      `SELECT artifact.content_key AS "contentKey",artifact.checksum,artifact.manifest_checksum AS "manifestChecksum",artifact.storage_path AS "storagePath",
              repository.canonical_url AS "canonicalUrl",revision.commit_sha AS "commitSha",revision.filter_fingerprint AS "filterFingerprint",
              artifact.file_count AS "fileCount",repository.display_name AS "repositoryTitle"
       FROM repositories repository
       JOIN repository_revisions revision ON revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id AND revision.commit_sha=$3
       JOIN repository_artifacts artifact ON artifact.content_key=revision.artifact_key
       WHERE repository.id=$1 AND repository.owner_id=$2 AND repository.disabled_at IS NULL`,
      [lease.sourceId, lease.ownerId, commitSha],
    );
    const descriptor = result.rows[0];
    if (!descriptor) throw new AppError("RAG_SOURCE_REVOKED", "The Repository document revision is no longer active.", 409);
    const document = await collectRepositoryDocument(config.repositoryArtifactRoot, descriptor, config.rag.repositoryDocuments, documentPath);
    if (document.contentHash !== contentHash || document.sourceRevision !== lease.sourceRevision || document.kind !== lease.sourceKind) {
      throw new AppError("RAG_SOURCE_REVOKED", "The Repository document no longer matches its immutable revision.", 409);
    }
    return { text: document.text, title: `${descriptor.repositoryTitle} / ${document.path}` };
  }
  throw new AppError("RAG_SOURCE_UNSUPPORTED", "The RAG source kind is not supported by this indexer.", 422);
}

async function persistEmbeddedSource(pool: Pool, lease: RagSourceLease, built: Awaited<ReturnType<typeof buildEmbeddedSource>>) {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const owned = await client.query<{ indexState: string }>(
      `SELECT version.state AS "indexState"
       FROM rag_source_versions source JOIN rag_index_versions version ON version.id=source.index_version_id
       WHERE source.id=$1 AND source.owner_id=$2 AND source.index_version_id=$3 AND source.state='processing'
         AND source.lease_owner=$4 AND source.lease_expires_at>now() FOR UPDATE OF source,version`,
      [lease.sourceVersionId, lease.ownerId, lease.indexVersionId, lease.leaseOwner],
    );
    const indexState = owned.rows[0]?.indexState;
    if (!indexState) throw new AppError("RAG_SOURCE_LEASE_LOST", "The RAG source lease is no longer owned by this worker.", 409);
    await client.query("DELETE FROM rag_parent_chunks WHERE source_version_id=$1 AND owner_id=$2", [lease.sourceVersionId, lease.ownerId]);
    const parentIds = new Map<string, string>();
    for (const parent of built.parents) {
      const stored = await client.query<{ id: string }>(
        `INSERT INTO rag_parent_chunks(owner_id,index_version_id,source_version_id,stable_key,position,content,token_count,structure_path,source_range,content_checksum)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING id`,
        [lease.ownerId, lease.indexVersionId, lease.sourceVersionId, parent.stableKey, parent.position, parent.content, parent.tokenCount, parent.structurePath, JSON.stringify(parent.sourceRange), parent.contentChecksum],
      );
      parentIds.set(parent.stableKey, stored.rows[0]!.id);
    }
    for (const child of built.children) {
      await client.query(
        `INSERT INTO rag_child_chunks(owner_id,index_version_id,source_version_id,parent_id,stable_key,position,content,contextual_content,token_count,source_range,content_checksum,embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::vector)`,
        [lease.ownerId, lease.indexVersionId, lease.sourceVersionId, parentIds.get(child.parentStableKey), child.stableKey, child.position, child.content, child.contextualContent, child.tokenCount, JSON.stringify(child.sourceRange), child.contentChecksum, `[${child.embedding.join(",")}]`],
      );
    }
    const nextState = indexState === "active" ? "active" : "ready";
    if (nextState === "active") {
      await client.query(
        `UPDATE rag_source_versions current
         SET state='superseded',superseded_at=now(),updated_at=now()
         FROM rag_source_versions incoming
         WHERE incoming.id=$5 AND current.index_version_id=$1 AND current.owner_id=$2 AND current.id<>incoming.id AND current.state='active'
           AND (
             ($3::rag_source_kind IN ('repository_markdown','repository_pdf') AND current.evidence_family_id=incoming.evidence_family_id)
             OR ($3::rag_source_kind NOT IN ('repository_markdown','repository_pdf') AND current.source_kind=$3 AND current.source_id=$4)
           )`,
        [lease.indexVersionId, lease.ownerId, lease.sourceKind, lease.sourceId, lease.sourceVersionId],
      );
    }
    await client.query(
      `UPDATE rag_source_versions SET state=$2::rag_source_state,parent_count=$3,child_count=$4,token_count=$5,
              lease_owner=NULL,lease_expires_at=NULL,failure_code=NULL,activated_at=CASE WHEN $2='active' THEN now() ELSE activated_at END,updated_at=now()
       WHERE id=$1`,
      [lease.sourceVersionId, nextState, built.parents.length, built.children.length, built.tokenCount],
    );
    await client.query("COMMIT");
    committed = true;
    await markIndexVersionReady(pool, lease.indexVersionId);
    if (lease.sourceKind === "repository_markdown" || lease.sourceKind === "repository_pdf") {
      const repositoryId = typeof lease.metadata.repositoryId === "string" ? lease.metadata.repositoryId : lease.sourceId;
      const commitSha = typeof lease.metadata.commitSha === "string" ? lease.metadata.commitSha : "";
      if (commitSha) await reconcileRepositoryDocumentIndex(pool, lease.ownerId, repositoryId, commitSha);
    }
    return { parentCount: built.parents.length, childCount: built.children.length, inputTokens: built.inputTokens };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function processRagSourceLease(pool: Pool, lease: RagSourceLease, config: RuntimeConfig, dependencies: { embeddingClient?: EmbeddingProvider } = {}) {
  const source = await loadSourceText(pool, lease, config);
  await renewRagSourceLease(pool, lease);
  const embeddingClient = dependencies.embeddingClient ?? new EmbeddingClient(config.embedding);
  const built = await buildEmbeddedSource({ text: source.text, sourceRevision: lease.sourceRevision, sourceTitle: source.title, config, embeddingClient });
  await renewRagSourceLease(pool, lease);
  return persistEmbeddedSource(pool, lease, built);
}

export async function failRagSourceLease(pool: Pool, lease: RagSourceLease, error: AppError) {
  const result = await pool.query(
    `UPDATE rag_source_versions SET state='failed',failure_code=$2,lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
     WHERE id=$1 AND state='processing' AND lease_owner=$3`,
    [lease.sourceVersionId, error.code, lease.leaseOwner],
  );
  const reconciled = (result.rowCount ?? 0) > 0;
  if (reconciled && (lease.sourceKind === "repository_markdown" || lease.sourceKind === "repository_pdf")) {
    const repositoryId = typeof lease.metadata.repositoryId === "string" ? lease.metadata.repositoryId : lease.sourceId;
    const commitSha = typeof lease.metadata.commitSha === "string" ? lease.metadata.commitSha : "";
    if (commitSha) await reconcileRepositoryDocumentIndex(pool, lease.ownerId, repositoryId, commitSha);
  }
  return reconciled;
}
