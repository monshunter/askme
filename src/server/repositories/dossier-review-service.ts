import type { Pool, PoolClient } from "pg";

import { AppError } from "@/server/errors";

import { readRepositoryArtifactEvidence, type RepositoryArtifactDescriptor } from "./artifact-reader";
import {
  citationContentHash,
  repositoryWikiMarkers,
  validateRepositoryWikiBundle,
  type RepositoryWikiCitation,
  type RepositoryWikiPage,
} from "./dossier-output";
import type { WikiProjectionPageInput } from "./repository-input";
import type { RepositoryVisibility } from "./repository-sync";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;
type WikiCitation = RepositoryWikiCitation & { rank: number };
type WikiPage = {
  id: string;
  path: string;
  title: string;
  generatedMarkdown: string;
  sortOrder: number;
  editedMarkdown: string | null;
  citations: WikiCitation[];
};
type WikiSummary = {
  id: string;
  revisionId: string;
  commitSha: string;
  generatedVersion: number;
  state: "generating" | "review_pending" | "failed" | "disabled";
  title: string;
  summary: string;
  coverage: Record<string, unknown>;
  configuredModel: string;
  actualModel: string | null;
  outdatedReason: string | null;
  createdAt: string;
  projectionId: string | null;
  projectionState: "draft" | "approved" | "superseded" | "disabled" | null;
};

export type CandidateRepositoryDossier = {
  repository: {
    id: string;
    displayName: string;
    visibility: RepositoryVisibility;
    activeRevisionId: string | null;
    activeProjectionId: string | null;
    activeDossierId: string | null;
  };
  dossier: (WikiSummary & { isActive: boolean; pages: WikiPage[] }) | null;
};

type ActiveRepositoryKnowledgeRow = {
  repositoryId: string;
  displayName: string;
  visibility: RepositoryVisibility;
  dossierId: string;
  revisionId: string;
  commitSha: string;
  generatedVersion: number;
  title: string;
  summary: string;
  coverage: Record<string, unknown>;
  outdatedReason: string | null;
  updatedAt: Date;
  projectionId: string;
};

async function requireCandidateRepository(queryable: Queryable, ownerId: string, repositoryId: string) {
  const result = await queryable.query<CandidateRepositoryDossier["repository"]>(
    `SELECT repository.id,repository.display_name AS "displayName",repository.visibility,repository.active_revision_id AS "activeRevisionId",
            repository.active_projection_id AS "activeProjectionId",active_projection.dossier_id AS "activeDossierId"
     FROM repositories repository
     LEFT JOIN repository_dossier_projections active_projection ON active_projection.id=repository.active_projection_id
     WHERE repository.id=$1 AND repository.owner_id=$2 AND repository.disabled_at IS NULL`,
    [repositoryId, ownerId],
  );
  const repository = result.rows[0];
  if (!repository) throw new AppError("REPOSITORY_NOT_FOUND", "The Repository was not found.", 404);
  return repository;
}

async function wikiPages(queryable: Queryable, dossierId: string, projectionId: string | null) {
  return (await queryable.query<WikiPage>(
    `SELECT page.id,page.path,page.title,page.generated_markdown AS "generatedMarkdown",page.sort_order AS "sortOrder",
            projected.edited_markdown AS "editedMarkdown",
            COALESCE(jsonb_agg(jsonb_build_object(
              'marker',citation.marker,'pagePath',page.path,'path',citation.path,'lineStart',citation.line_start,
              'lineEnd',citation.line_end,'contentHash',citation.content_hash,'rank',citation.rank
            ) ORDER BY citation.rank) FILTER (WHERE citation.id IS NOT NULL),'[]'::jsonb) AS citations
     FROM repository_wiki_pages page
     LEFT JOIN repository_wiki_projection_pages projected ON projected.page_id=page.id AND projected.dossier_id=page.dossier_id AND projected.projection_id=$2
     LEFT JOIN repository_wiki_citations citation ON citation.page_id=page.id AND citation.dossier_id=page.dossier_id
     WHERE page.dossier_id=$1
     GROUP BY page.id,projected.projection_id,projected.page_id,projected.edited_markdown
     ORDER BY page.sort_order,page.id`,
    [dossierId, projectionId],
  )).rows;
}

export async function getCandidateActiveRepositoryKnowledge(pool: Queryable, ownerId: string, repositoryId: string) {
  const result = await pool.query<ActiveRepositoryKnowledgeRow>(
    `SELECT repository.id AS "repositoryId",repository.display_name AS "displayName",repository.visibility,
            dossier.id AS "dossierId",dossier.revision_id AS "revisionId",revision.commit_sha AS "commitSha",
            dossier.generated_version AS "generatedVersion",dossier.wiki_title AS title,dossier.wiki_summary AS summary,
            dossier.coverage,dossier.outdated_reason AS "outdatedReason",greatest(repository.updated_at,projection.updated_at) AS "updatedAt",
            projection.id AS "projectionId"
     FROM repositories repository
     JOIN repository_revisions revision ON revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id
     JOIN repository_dossier_projections projection ON projection.id=repository.active_projection_id AND projection.state='approved'
     JOIN repository_dossiers dossier ON dossier.id=projection.dossier_id AND dossier.repository_id=repository.id
       AND dossier.revision_id=revision.id AND dossier.owner_id=repository.owner_id AND dossier.wiki_manifest IS NOT NULL
     WHERE repository.id=$1 AND repository.owner_id=$2 AND repository.disabled_at IS NULL AND repository.visibility<>'private'
       AND EXISTS (
         SELECT 1 FROM repository_wiki_pages ready_page
         JOIN repository_wiki_projection_pages ready_projected
           ON ready_projected.page_id=ready_page.id AND ready_projected.dossier_id=ready_page.dossier_id AND ready_projected.projection_id=projection.id
         WHERE ready_page.dossier_id=dossier.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM repository_wiki_pages expected_page
         WHERE expected_page.dossier_id=dossier.id
           AND NOT EXISTS (
             SELECT 1 FROM repository_wiki_projection_pages expected_projected
             WHERE expected_projected.page_id=expected_page.id AND expected_projected.dossier_id=expected_page.dossier_id
               AND expected_projected.projection_id=projection.id
           )
       )`,
    [repositoryId, ownerId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError("REPOSITORY_KNOWLEDGE_NOT_FOUND", "The active Repository knowledge was not found.", 404);
  return {
    sourceKind: "repository_wiki" as const,
    repository: { id: row.repositoryId, displayName: row.displayName, visibility: row.visibility },
    dossier: {
      id: row.dossierId,
      revisionId: row.revisionId,
      commitSha: row.commitSha,
      generatedVersion: row.generatedVersion,
      title: row.title,
      summary: row.summary,
      coverage: row.coverage,
      outdatedReason: row.outdatedReason,
      updatedAt: row.updatedAt,
      pages: await wikiPages(pool, row.dossierId, row.projectionId),
    },
  };
}

export async function getCandidateRepositoryDossier(pool: Queryable, ownerId: string, repositoryId: string): Promise<CandidateRepositoryDossier> {
  const repository = await requireCandidateRepository(pool, ownerId, repositoryId);
  const dossierResult = await pool.query<WikiSummary>(
    `SELECT dossier.id,dossier.revision_id AS "revisionId",revision.commit_sha AS "commitSha",dossier.generated_version AS "generatedVersion",
            dossier.state,dossier.wiki_title AS title,dossier.wiki_summary AS summary,dossier.coverage,
            dossier.configured_model AS "configuredModel",dossier.actual_model AS "actualModel",
            dossier.outdated_reason AS "outdatedReason",dossier.created_at AS "createdAt",
            projection.id AS "projectionId",projection.state AS "projectionState"
     FROM repository_dossiers dossier
     JOIN repository_revisions revision ON revision.id=dossier.revision_id AND revision.owner_id=dossier.owner_id
     LEFT JOIN LATERAL (
       SELECT candidate.* FROM repository_dossier_projections candidate
       WHERE candidate.dossier_id=dossier.id AND candidate.state IN ('draft','approved')
       ORDER BY (candidate.state='draft') DESC,candidate.updated_at DESC LIMIT 1
     ) projection ON true
     WHERE dossier.repository_id=$1 AND dossier.owner_id=$2 AND dossier.wiki_manifest IS NOT NULL
     ORDER BY dossier.generated_version DESC,dossier.created_at DESC LIMIT 1`,
    [repositoryId, ownerId],
  );
  const dossier = dossierResult.rows[0];
  if (!dossier) return { repository, dossier: null };
  return {
    repository,
    dossier: {
      ...dossier,
      isActive: repository.activeRevisionId === dossier.revisionId
        && repository.activeDossierId === dossier.id
        && repository.activeProjectionId === dossier.projectionId,
      pages: await wikiPages(pool, dossier.id, dossier.projectionId),
    },
  };
}

async function ensureDraftProjection(client: PoolClient, dossierId: string, repositoryVisibility: RepositoryVisibility) {
  if (repositoryVisibility === "private") throw new AppError("DOSSIER_REPOSITORY_PRIVATE", "A private Repository cannot expose a Repository Wiki.", 409);
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM repository_dossier_projections WHERE dossier_id=$1 AND state='draft' FOR UPDATE`,
    [dossierId],
  );
  let projectionId = existing.rows[0]?.id;
  if (!projectionId) {
    projectionId = (await client.query<{ id: string }>(
      `INSERT INTO repository_dossier_projections(dossier_id,state) VALUES ($1,'draft') RETURNING id`,
      [dossierId],
    )).rows[0]?.id;
  }
  if (!projectionId) throw new AppError("WIKI_PROJECTION_WRITE_FAILED", "The Repository Wiki projection could not be created.", 500);
  await client.query(
    `INSERT INTO repository_wiki_projection_pages(projection_id,page_id,dossier_id)
     SELECT $2,page.id,page.dossier_id FROM repository_wiki_pages page WHERE page.dossier_id=$1
     ON CONFLICT(projection_id,page_id) DO NOTHING`,
    [dossierId, projectionId],
  );
  return projectionId;
}

export async function updateCandidateWikiProjectionPage(input: {
  pool: Pool;
  ownerId: string;
  repositoryId: string;
  change: WikiProjectionPageInput;
  requestId?: string;
}) {
  const client = await input.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [input.repositoryId]);
    const target = await client.query<{ dossierId: string; repositoryVisibility: RepositoryVisibility }>(
      `SELECT dossier.id AS "dossierId",repository.visibility AS "repositoryVisibility"
       FROM repositories repository
       JOIN repository_dossiers dossier ON dossier.repository_id=repository.id AND dossier.owner_id=repository.owner_id
       JOIN repository_wiki_pages page ON page.dossier_id=dossier.id
       WHERE repository.id=$1 AND repository.owner_id=$2 AND repository.disabled_at IS NULL
         AND dossier.state='review_pending' AND dossier.wiki_manifest IS NOT NULL AND page.id=$3
       FOR UPDATE OF repository,dossier,page`,
      [input.repositoryId, input.ownerId, input.change.pageId],
    );
    const row = target.rows[0];
    if (!row) throw new AppError("WIKI_PAGE_NOT_FOUND", "The generated Repository Wiki page was not found.", 404);
    const projectionId = await ensureDraftProjection(client, row.dossierId, row.repositoryVisibility);
    const updated = await client.query<{ pageId: string; editedMarkdown: string | null }>(
      `UPDATE repository_wiki_projection_pages SET edited_markdown=$3,updated_at=now()
       WHERE projection_id=$1 AND page_id=$2
       RETURNING page_id AS "pageId",edited_markdown AS "editedMarkdown"`,
      [projectionId, input.change.pageId, input.change.editedMarkdown],
    );
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','repository.wiki.projection.update','repository_dossier_projection',$2,'updated',$3,$4::jsonb)`,
      [input.ownerId, projectionId, input.requestId ?? null, JSON.stringify({ repositoryId: input.repositoryId, dossierId: row.dossierId, pageId: input.change.pageId, edited: input.change.editedMarkdown !== null })],
    );
    await client.query("COMMIT");
    return { projectionId, page: updated.rows[0]! };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type ApprovalContext = RepositoryArtifactDescriptor & {
  dossierId: string;
  ownerId: string;
  repositoryId: string;
  revisionId: string;
  repositoryVisibility: RepositoryVisibility;
  repositoryDisabledAt: Date | null;
  dossierState: "generating" | "review_pending" | "failed" | "disabled";
  revisionState: "staging" | "stored" | "failed" | "collected";
};

async function approvalContext(queryable: Queryable, ownerId: string, repositoryId: string, dossierId: string, forUpdate = false) {
  const result = await queryable.query<ApprovalContext>(
    `SELECT dossier.id AS "dossierId",dossier.owner_id AS "ownerId",dossier.repository_id AS "repositoryId",dossier.revision_id AS "revisionId",
            dossier.state AS "dossierState",repository.visibility AS "repositoryVisibility",repository.disabled_at AS "repositoryDisabledAt",
            repository.canonical_url AS "canonicalUrl",revision.commit_sha AS "commitSha",revision.filter_fingerprint AS "filterFingerprint",
            revision.state AS "revisionState",artifact.content_key AS "contentKey",artifact.checksum,artifact.manifest_checksum AS "manifestChecksum",
            artifact.storage_path AS "storagePath",artifact.file_count AS "fileCount"
     FROM repository_dossiers dossier
     JOIN repositories repository ON repository.id=dossier.repository_id AND repository.owner_id=dossier.owner_id
     JOIN repository_revisions revision ON revision.id=dossier.revision_id AND revision.owner_id=dossier.owner_id
     JOIN repository_artifacts artifact ON artifact.content_key=revision.artifact_key
     WHERE dossier.id=$1 AND repository.id=$2 AND repository.owner_id=$3 AND dossier.wiki_manifest IS NOT NULL
     ${forUpdate ? "FOR UPDATE OF dossier,repository,revision,artifact" : ""}`,
    [dossierId, repositoryId, ownerId],
  );
  const context = result.rows[0];
  if (!context) throw new AppError("REPOSITORY_WIKI_NOT_FOUND", "The generated Repository Wiki was not found.", 404);
  if (context.repositoryDisabledAt || context.dossierState !== "review_pending" || context.revisionState !== "stored") {
    throw new AppError("REPOSITORY_WIKI_NOT_APPROVABLE", "The generated Repository Wiki cannot be approved in its current state.", 409);
  }
  if (context.repositoryVisibility === "private") throw new AppError("DOSSIER_REPOSITORY_PRIVATE", "A private Repository cannot expose a Repository Wiki.", 409);
  return context;
}

function effectiveWikiPages(pages: WikiPage[]): RepositoryWikiPage[] {
  return pages.map((page) => ({
    path: page.path,
    title: page.title,
    order: page.sortOrder,
    markdown: page.editedMarkdown ?? page.generatedMarkdown,
  }));
}

function wikiFingerprint(pages: WikiPage[]) {
  return JSON.stringify(pages.map((page) => ({
    id: page.id,
    path: page.path,
    title: page.title,
    generatedMarkdown: page.generatedMarkdown,
    sortOrder: page.sortOrder,
    editedMarkdown: page.editedMarkdown,
    citations: page.citations,
  })));
}

async function validateApprovalWiki(queryable: Queryable, artifactRoot: string, context: ApprovalContext, projectionId: string | null) {
  const pages = await wikiPages(queryable, context.dossierId, projectionId);
  if (pages.length === 0) throw new AppError("WIKI_FILES_INVALID", "The Repository Wiki has no generated pages.", 422);
  const effectivePages = effectiveWikiPages(pages);
  const referencedMarkers = new Set(effectivePages.flatMap((page) => repositoryWikiMarkers(page.markdown)));
  const citations = pages.flatMap((page) => page.citations).filter((citation) => referencedMarkers.has(citation.marker));
  validateRepositoryWikiBundle(effectivePages, citations);
  const evidence = await readRepositoryArtifactEvidence(artifactRoot, context, [...new Set(citations.map((citation) => citation.path))]);
  for (const citation of citations) {
    const source = evidence.sources.get(citation.path);
    if (source === undefined || citationContentHash(source, citation.lineStart, citation.lineEnd) !== citation.contentHash) {
      throw new AppError("WIKI_APPROVAL_CITATION_INVALID", "A Repository Wiki Citation no longer matches the immutable Repository source.", 422);
    }
  }
  return { fingerprint: wikiFingerprint(pages) };
}

function sameApprovalContext(left: ApprovalContext, right: ApprovalContext) {
  return left.repositoryId === right.repositoryId && left.revisionId === right.revisionId && left.contentKey === right.contentKey
    && left.checksum === right.checksum && left.manifestChecksum === right.manifestChecksum && left.repositoryVisibility === right.repositoryVisibility;
}

export async function approveCandidateRepositoryDossier(input: {
  pool: Pool;
  artifactRoot: string;
  ownerId: string;
  repositoryId: string;
  dossierId: string;
  requestId?: string;
}) {
  const initial = await approvalContext(input.pool, input.ownerId, input.repositoryId, input.dossierId);
  const existingProjection = await input.pool.query<{ id: string }>(
    `SELECT id FROM repository_dossier_projections WHERE dossier_id=$1 AND state='draft' ORDER BY updated_at DESC LIMIT 1`,
    [input.dossierId],
  );
  const verified = await validateApprovalWiki(input.pool, input.artifactRoot, initial, existingProjection.rows[0]?.id ?? null);
  const client = await input.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [input.repositoryId]);
    const current = await approvalContext(client, input.ownerId, input.repositoryId, input.dossierId, true);
    if (!sameApprovalContext(initial, current)) throw new AppError("WIKI_APPROVAL_CONTEXT_CHANGED", "The Repository Wiki approval context changed before completion.", 409);
    const projectionId = await ensureDraftProjection(client, input.dossierId, current.repositoryVisibility);
    const currentPages = await wikiPages(client, input.dossierId, projectionId);
    if (wikiFingerprint(currentPages) !== verified.fingerprint) throw new AppError("WIKI_APPROVAL_CONTEXT_CHANGED", "The Repository Wiki changed before approval.", 409);
    await client.query(
      `UPDATE repository_dossier_projections SET state='superseded',superseded_at=now(),updated_at=now()
       WHERE id=(SELECT active_projection_id FROM repositories WHERE id=$1 AND owner_id=$2) AND id<>$3 AND state='approved'`,
      [input.repositoryId, input.ownerId, projectionId],
    );
    await client.query(
      `UPDATE repository_dossier_projections SET state='approved',approved_by=$2,approved_at=now(),updated_at=now() WHERE id=$1 AND state='draft'`,
      [projectionId, input.ownerId],
    );
    const activated = await client.query<{ activeRevisionId: string; activeProjectionId: string }>(
      `UPDATE repositories SET active_revision_id=$3,active_projection_id=$4,updated_at=now()
       WHERE id=$1 AND owner_id=$2 AND disabled_at IS NULL AND visibility<>'private'
       RETURNING active_revision_id AS "activeRevisionId",active_projection_id AS "activeProjectionId"`,
      [input.repositoryId, input.ownerId, current.revisionId, projectionId],
    );
    if (!activated.rows[0]) throw new AppError("WIKI_APPROVAL_CONTEXT_CHANGED", "The Repository authorization changed before approval.", 409);
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','repository.wiki.approve','repository_dossier_projection',$2,'approved',$3,$4::jsonb)`,
      [input.ownerId, projectionId, input.requestId ?? null, JSON.stringify({ repositoryId: input.repositoryId, revisionId: current.revisionId, dossierId: input.dossierId })],
    );
    await client.query("COMMIT");
    return { dossierId: input.dossierId, projectionId, ...activated.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markRepositoryDossiersOutdated(pool: Queryable, provenance: { imageDigest: string; skillHash: string; promptVersion: string; profileFingerprint: string }) {
  const result = await pool.query<{ id: string }>(
    `UPDATE repository_dossiers dossier SET outdated_reason='runtime_provenance_changed',updated_at=now()
     FROM repositories repository,repository_dossier_projections projection
     WHERE repository.active_projection_id=projection.id AND projection.dossier_id=dossier.id AND repository.active_revision_id=dossier.revision_id
       AND dossier.repository_id=repository.id AND dossier.owner_id=repository.owner_id AND dossier.outdated_reason IS NULL
       AND (dossier.image_digest<>$1 OR dossier.skill_hash<>$2 OR dossier.prompt_version<>$3 OR dossier.profile_fingerprint<>$4)
     RETURNING dossier.id`,
    [provenance.imageDigest, provenance.skillHash, provenance.promptVersion, provenance.profileFingerprint],
  );
  return { markedOutdated: result.rows.length };
}
