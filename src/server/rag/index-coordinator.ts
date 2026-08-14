import { createHash } from "node:crypto";

import type { Pool } from "pg";

import type { RuntimeConfig } from "@/server/config";
import { AppError } from "@/server/errors";

type Queryable = Pick<Pool, "query">;

export function indexVersionDescriptor(config: RuntimeConfig) {
  const identity = {
    chunkingVersion: "structure-parent-child-v2",
    chunking: config.rag.chunking,
    embeddingProvider: "openai-compatible",
    embeddingModel: config.embedding.model,
    embeddingDimensions: config.embedding.dimensions,
    contextPrefixVersion: "source-context-v1",
    distanceMetric: "cosine" as const,
  };
  return {
    ...identity,
    configFingerprint: createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
  };
}

export async function startIndexRebuild(pool: Pool, config: RuntimeConfig) {
  const descriptor = indexVersionDescriptor(config);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query<{ id: string }>(
      `INSERT INTO rag_index_versions(
         state,config_fingerprint,chunking_version,embedding_provider,embedding_model,
         embedding_dimensions,context_prefix_version,distance_metric
       ) VALUES ('building',$1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [descriptor.configFingerprint, descriptor.chunkingVersion, descriptor.embeddingProvider, descriptor.embeddingModel, descriptor.embeddingDimensions, descriptor.contextPrefixVersion, descriptor.distanceMetric],
    );
    const indexVersionId = created.rows[0]?.id;
    if (!indexVersionId) {
      const existing = await client.query<{ id: string; expectedSourceCount: number }>(
        `SELECT id,expected_source_count AS "expectedSourceCount"
         FROM rag_index_versions
         WHERE config_fingerprint=$1 AND state IN ('building','ready','active')
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [descriptor.configFingerprint],
      );
      const row = existing.rows[0];
      if (!row) throw new AppError("RAG_INDEX_CREATE_FAILED", "The RAG index version could not be created.", 500);
      await client.query("COMMIT");
      return { indexVersionId: row.id, expectedSourceCount: row.expectedSourceCount, reused: true };
    }

    const materials = await client.query(
      `INSERT INTO rag_source_versions(
         owner_id,source_kind,source_id,source_revision,index_version_id,state,visibility,evidence_family_id,metadata
       )
       SELECT material.owner_id,'material',material.id,material.content_checksum,$1,'queued',material.visibility,
              encode(digest('material:' || material.id::text,'sha256'),'hex'),
              jsonb_build_object('title',material.title,'kind',material.kind,'checksum',material.content_checksum)
       FROM materials material
       WHERE material.status='indexed' AND material.content_checksum IS NOT NULL
       ON CONFLICT DO NOTHING`,
      [indexVersionId],
    );
    const wikis = await client.query(
      `INSERT INTO rag_source_versions(
         owner_id,source_kind,source_id,source_revision,index_version_id,state,visibility,evidence_family_id,metadata
       )
       SELECT repository.owner_id,'approved_wiki',page.id,
              encode(digest(projection.id::text || ':' || coalesce(projected.edited_markdown,page.generated_markdown),'sha256'),'hex'),
              $1,'queued',repository.visibility,
              encode(digest('repository:' || repository.id::text,'sha256'),'hex'),
              jsonb_build_object('repositoryId',repository.id,'repositoryTitle',repository.display_name,'pageTitle',page.title,'path',page.path,'projectionId',projection.id,'revisionId',revision.id,'commitSha',revision.commit_sha)
       FROM repositories repository
       JOIN repository_revisions revision ON revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id
       JOIN repository_dossier_projections projection ON projection.id=repository.active_projection_id AND projection.state='approved'
       JOIN repository_dossiers dossier ON dossier.id=projection.dossier_id AND dossier.revision_id=revision.id AND dossier.owner_id=repository.owner_id
       JOIN repository_wiki_pages page ON page.dossier_id=dossier.id
       JOIN repository_wiki_projection_pages projected ON projected.projection_id=projection.id AND projected.page_id=page.id AND projected.dossier_id=dossier.id
       WHERE repository.disabled_at IS NULL
       ON CONFLICT DO NOTHING`,
      [indexVersionId],
    );
    const expectedSourceCount = (materials.rowCount ?? 0) + (wikis.rowCount ?? 0);
    await client.query(
      `UPDATE rag_index_versions
       SET expected_source_count=$2,state=CASE WHEN $2=0 THEN 'ready'::rag_index_state ELSE state END,updated_at=now()
       WHERE id=$1`,
      [indexVersionId, expectedSourceCount],
    );
    await client.query("COMMIT");
    return { indexVersionId, expectedSourceCount, reused: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function markIndexVersionReady(pool: Pool, indexVersionId: string) {
  const result = await pool.query<{ id: string }>(
    `UPDATE rag_index_versions version
     SET state='ready',failure_code=NULL,updated_at=now()
     WHERE version.id=$1 AND version.state='building'
       AND version.expected_source_count=(SELECT count(*)::integer FROM rag_source_versions source WHERE source.index_version_id=version.id)
       AND NOT EXISTS (
         SELECT 1 FROM rag_source_versions source
         WHERE source.index_version_id=version.id AND source.state NOT IN ('ready','ready_with_warnings')
       )
     RETURNING id`,
    [indexVersionId],
  );
  if (result.rows[0]) return true;
  const current = await pool.query<{ ready: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM rag_index_versions WHERE id=$1 AND state IN ('ready','active')
     ) AS ready`,
    [indexVersionId],
  );
  return current.rows[0]?.ready === true;
}

export async function activateIndexVersion(pool: Pool, indexVersionId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('askme-rag-index-activation'))");
    const current = await client.query<{ id: string; state: string; expectedSourceCount: number; readySourceCount: number }>(
      `SELECT version.id,version.state,version.expected_source_count AS "expectedSourceCount",
              (SELECT count(*)::integer FROM rag_source_versions source
               WHERE source.index_version_id=version.id AND source.state IN ('ready','ready_with_warnings','active')) AS "readySourceCount"
       FROM rag_index_versions version
       WHERE version.id=$1
       FOR UPDATE`,
      [indexVersionId],
    );
    const version = current.rows[0];
    if (!version || !new Set(["ready", "active"]).has(version.state) || version.expectedSourceCount !== version.readySourceCount) {
      throw new AppError("RAG_INDEX_NOT_READY", "The RAG index version is not ready for activation.", 409);
    }
    if (version.state === "active") {
      await client.query("COMMIT");
      return;
    }
    await client.query(
      `UPDATE rag_source_versions
       SET state='superseded',superseded_at=now(),updated_at=now()
       WHERE index_version_id IN (SELECT id FROM rag_index_versions WHERE state='active') AND state='active'`,
    );
    await client.query("UPDATE rag_index_versions SET state='superseded',superseded_at=now(),updated_at=now() WHERE state='active'");
    await client.query(
      `UPDATE rag_source_versions SET state='active',activated_at=now(),updated_at=now()
       WHERE index_version_id=$1 AND state IN ('ready','ready_with_warnings')`,
      [indexVersionId],
    );
    await client.query("UPDATE rag_index_versions SET state='active',activated_at=now(),updated_at=now() WHERE id=$1 AND state='ready'", [indexVersionId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function enqueueMaterialSourceForOpenIndexes(queryable: Queryable, materialId: string, ownerId: string) {
  const result = await queryable.query<{ indexVersionId: string }>(
    `WITH inserted AS (
       INSERT INTO rag_source_versions(
         owner_id,source_kind,source_id,source_revision,index_version_id,state,visibility,evidence_family_id,metadata
       )
       SELECT material.owner_id,'material',material.id,material.content_checksum,version.id,'queued',material.visibility,
              encode(digest('material:' || material.id::text,'sha256'),'hex'),
              jsonb_build_object('title',material.title,'kind',material.kind,'checksum',material.content_checksum)
       FROM materials material
       CROSS JOIN rag_index_versions version
       WHERE material.id=$1 AND material.owner_id=$2 AND material.status='indexed' AND material.content_checksum IS NOT NULL
         AND version.state IN ('building','ready','active')
       ON CONFLICT DO NOTHING
       RETURNING index_version_id
     ), updated AS (
       UPDATE rag_index_versions version
       SET expected_source_count=expected_source_count+counts.added,
           state=CASE WHEN version.state='ready' THEN 'building'::rag_index_state ELSE version.state END,updated_at=now()
       FROM (SELECT index_version_id,count(*)::integer AS added FROM inserted GROUP BY index_version_id) counts
       WHERE version.id=counts.index_version_id AND version.state IN ('building','ready')
       RETURNING version.id
     )
     SELECT index_version_id AS "indexVersionId" FROM inserted`,
    [materialId, ownerId],
  );
  return result.rows.map((row) => row.indexVersionId);
}

export async function enqueueApprovedWikiSourcesForOpenIndexes(queryable: Queryable, ownerId: string, repositoryId: string) {
  await queryable.query(
    `UPDATE rag_source_versions source
     SET state='superseded',superseded_at=now(),lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
     FROM repositories repository
     WHERE repository.id=$2 AND repository.owner_id=$1 AND repository.active_projection_id IS NOT NULL
       AND source.owner_id=repository.owner_id AND source.source_kind='approved_wiki'
       AND source.metadata->>'repositoryId'=repository.id::text
       AND source.metadata->>'projectionId'<>repository.active_projection_id::text
       AND source.state IN ('queued','processing','ready','ready_with_warnings','active')`,
    [ownerId, repositoryId],
  );
  const result = await queryable.query<{ indexVersionId: string }>(
    `WITH inserted AS (
       INSERT INTO rag_source_versions(
         owner_id,source_kind,source_id,source_revision,index_version_id,state,visibility,evidence_family_id,metadata
       )
       SELECT repository.owner_id,'approved_wiki',page.id,
              encode(digest(projection.id::text || ':' || coalesce(projected.edited_markdown,page.generated_markdown),'sha256'),'hex'),
              version.id,'queued',repository.visibility,encode(digest('repository:' || repository.id::text,'sha256'),'hex'),
              jsonb_build_object('repositoryId',repository.id,'repositoryTitle',repository.display_name,'pageTitle',page.title,
                'path',page.path,'projectionId',projection.id,'revisionId',revision.id,'commitSha',revision.commit_sha)
       FROM repositories repository
       JOIN repository_revisions revision ON revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id
       JOIN repository_dossier_projections projection ON projection.id=repository.active_projection_id AND projection.state='approved'
       JOIN repository_dossiers dossier ON dossier.id=projection.dossier_id AND dossier.revision_id=revision.id AND dossier.owner_id=repository.owner_id
       JOIN repository_wiki_pages page ON page.dossier_id=dossier.id
       JOIN repository_wiki_projection_pages projected ON projected.projection_id=projection.id AND projected.page_id=page.id AND projected.dossier_id=dossier.id
       CROSS JOIN rag_index_versions version
       WHERE repository.id=$2 AND repository.owner_id=$1 AND repository.disabled_at IS NULL AND version.state IN ('building','ready','active')
       ON CONFLICT(index_version_id,owner_id,source_kind,source_id,source_revision) DO UPDATE SET
         state='queued',visibility=EXCLUDED.visibility,evidence_family_id=EXCLUDED.evidence_family_id,metadata=EXCLUDED.metadata,
         warning_codes='[]'::jsonb,parent_count=0,child_count=0,token_count=0,failure_code=NULL,
         lease_owner=NULL,lease_expires_at=NULL,activated_at=NULL,superseded_at=NULL,revoked_at=NULL,updated_at=now()
       WHERE rag_source_versions.state IN ('revoked','superseded','failed')
       RETURNING index_version_id
     ), updated AS (
       UPDATE rag_index_versions version SET expected_source_count=expected_source_count+counts.added,
         state=CASE WHEN version.state='ready' THEN 'building'::rag_index_state ELSE version.state END,updated_at=now()
       FROM (SELECT index_version_id,count(*)::integer AS added FROM inserted GROUP BY index_version_id) counts
       WHERE version.id=counts.index_version_id AND version.state IN ('building','ready')
       RETURNING version.id
     ) SELECT index_version_id AS "indexVersionId" FROM inserted`,
    [ownerId, repositoryId],
  );
  await reconcileOpenIndexExpectedSourceCounts(queryable);
  return result.rows.map((row) => row.indexVersionId);
}

export async function reconcileOpenIndexExpectedSourceCounts(queryable: Queryable) {
  await queryable.query(
    `UPDATE rag_index_versions version SET expected_source_count=(
       SELECT count(*)::integer FROM rag_source_versions source
       WHERE source.index_version_id=version.id AND source.state NOT IN ('revoked','superseded')
     ),updated_at=now()
     WHERE version.state IN ('building','ready','active')`,
  );
}
