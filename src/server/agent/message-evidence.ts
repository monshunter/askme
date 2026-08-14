import type { PoolClient } from "pg";

import { allowedVisibilities, type VisibilityConsumer } from "@/server/privacy/visibility-policy";
import { AppError } from "@/server/errors";

import { documentSourceIdentity } from "./citation-dedup";
import { isRepositoryEvidence, type RetrievedDocumentEvidence, type RetrievedEvidence } from "./retrieval";

export function answerCitationCount(citations: RetrievedEvidence[]) {
  const documentSources = new Set<string>();
  let repositorySources = 0;
  for (const citation of citations) {
    if (isRepositoryEvidence(citation)) repositorySources += citation.sourceCitations.length;
    else documentSources.add(documentSourceIdentity(citation));
  }
  return documentSources.size + repositorySources;
}

export async function validateAnswerEvidence(
  client: PoolClient,
  ownerId: string,
  consumer: VisibilityConsumer,
  citations: RetrievedEvidence[],
) {
  const visibility = allowedVisibilities(consumer);
  const documents = citations.filter((citation): citation is RetrievedDocumentEvidence => !isRepositoryEvidence(citation));
  if (documents.length > 0) {
    const allowed = await client.query<{ id: string }>(
      `SELECT chunk.id FROM chunks chunk
       JOIN materials material ON material.id=chunk.material_id AND material.owner_id=chunk.owner_id
       WHERE chunk.owner_id=$1 AND chunk.id=ANY($2::uuid[]) AND material.status='indexed'
         AND material.visibility=ANY($3::visibility[])`,
      [ownerId, documents.map((citation) => citation.chunkId), visibility],
    );
    if (allowed.rows.length !== documents.length) {
      throw new AppError("SOURCE_PERMISSION_CHANGED", "Source permissions changed while the answer was generated. Retry the question.", 409);
    }
  }
  for (const evidence of citations.filter(isRepositoryEvidence)) {
    for (const citation of evidence.sourceCitations) {
      const allowed = await client.query(
        `SELECT 1
         FROM repositories repository
         JOIN repository_revisions revision ON revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id
         JOIN repository_dossier_projections projection ON projection.id=repository.active_projection_id AND projection.state='approved'
         JOIN repository_dossiers dossier ON dossier.id=projection.dossier_id AND dossier.revision_id=revision.id AND dossier.owner_id=repository.owner_id
         JOIN repository_wiki_pages page ON page.id=$4 AND page.dossier_id=dossier.id
         JOIN repository_wiki_projection_pages projected ON projected.projection_id=projection.id AND projected.page_id=page.id AND projected.dossier_id=dossier.id
         JOIN repository_wiki_citations source ON source.page_id=page.id AND source.dossier_id=dossier.id AND source.revision_id=revision.id
         WHERE repository.id=$2 AND repository.owner_id=$1 AND repository.disabled_at IS NULL
           AND revision.id=$3 AND repository.visibility=ANY($5::visibility[])
           AND source.marker=$6 AND source.path=$7 AND source.line_start=$8 AND source.line_end=$9 AND source.content_hash=$10
           AND position('[' || source.marker || ']' in coalesce(projected.edited_markdown,page.generated_markdown)) > 0
         LIMIT 1`,
        [ownerId, evidence.repositoryId, evidence.revisionId, evidence.repositoryWikiPageId, visibility, citation.marker, citation.path, citation.lineStart, citation.lineEnd, citation.contentHash],
      );
      if (!allowed.rows[0]) {
        throw new AppError("SOURCE_PERMISSION_CHANGED", "Repository permissions changed while the answer was generated. Retry the question.", 409);
      }
    }
  }
}

export async function persistAnswerCitations(client: PoolClient, ownerId: string, messageId: string, citations: RetrievedEvidence[]) {
  let rank = 1;
  for (const evidence of citations) {
    if (isRepositoryEvidence(evidence)) {
      for (const citation of evidence.sourceCitations) {
        await client.query(
          `INSERT INTO repository_message_citations(message_id,owner_id,repository_id,revision_id,rank,path,line_start,line_end,content_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [messageId, ownerId, evidence.repositoryId, evidence.revisionId, rank, citation.path, citation.lineStart, citation.lineEnd, citation.contentHash],
        );
        rank += 1;
      }
      continue;
    }
    await client.query(
      `INSERT INTO message_citations(message_id,chunk_id,owner_id,rank,excerpt)
       VALUES ($1,$2,$3,$4,$5)`,
      [messageId, evidence.chunkId, ownerId, rank, evidence.content.slice(0, 500)],
    );
    rank += 1;
  }
}
