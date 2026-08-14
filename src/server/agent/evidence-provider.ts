import type { Pool } from "pg";

import { allowedVisibilities, type VisibilityConsumer } from "@/server/privacy/visibility-policy";
import { repositoryWikiMarkers, repositoryWikiSections } from "@/server/repositories/dossier-output";

import { searchEvidence, type RetrievedEvidence, type RetrievedRepositoryEvidence } from "./retrieval";
import { buildEvidenceSearchQuery, parseEvidenceQuery, type EvidenceQuery } from "./retrieval-input";

type RepositoryWikiRow = {
  repositoryWikiPageId: string;
  repositoryId: string;
  repositoryTitle: string;
  wikiPagePath: string;
  wikiPageTitle: string;
  revisionId: string;
  commitSha: string;
  visibility: RetrievedRepositoryEvidence["visibility"];
  markdown: string;
  score: number;
  marker: string;
  citationRank: number;
  path: string;
  lineStart: number;
  lineEnd: number;
  contentHash: string;
};

function escapeLikePattern(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

function queryTerms(value: string) {
  return [...new Set(value.toLocaleLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 2))].slice(0, 20);
}

function repositoryContentTerms(query: string, repositoryTitle: string) {
  const entityTerms = new Set(queryTerms(repositoryTitle));
  return queryTerms(query).filter((term) => !entityTerms.has(term));
}

function sectionScore(content: string, terms: string[], base: number) {
  const normalized = content.toLocaleLowerCase();
  return base + terms.reduce((score, term) => score + (normalized.includes(term) ? 0.2 : 0), 0);
}

export async function retrieveUnifiedEvidence(
  pool: Pool,
  ownerId: string,
  consumer: VisibilityConsumer,
  input: EvidenceQuery,
): Promise<RetrievedEvidence[]> {
  const query = parseEvidenceQuery(input);
  const documents = await searchEvidence(pool, ownerId, consumer, query);
  const searchQuery = buildEvidenceSearchQuery(query.query);
  const entityTerms = queryTerms(query.query);
  const repositories = await pool.query<RepositoryWikiRow>(
    `SELECT page.id AS "repositoryWikiPageId",repository.id AS "repositoryId",repository.display_name AS "repositoryTitle",
            page.path AS "wikiPagePath",page.title AS "wikiPageTitle",revision.id AS "revisionId",revision.commit_sha AS "commitSha",
            repository.visibility,coalesce(projected.edited_markdown,page.generated_markdown) AS markdown,
            ts_rank_cd(to_tsvector('simple',page.title || ' ' || coalesce(projected.edited_markdown,page.generated_markdown)),websearch_to_tsquery('simple',$3))::real AS score,
            citation.marker,citation.rank AS "citationRank",citation.path,citation.line_start AS "lineStart",
            citation.line_end AS "lineEnd",citation.content_hash AS "contentHash"
     FROM repositories repository
     JOIN repository_revisions revision ON revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id
     JOIN repository_dossier_projections projection ON projection.id=repository.active_projection_id AND projection.state='approved'
     JOIN repository_dossiers dossier ON dossier.id=projection.dossier_id AND dossier.revision_id=revision.id AND dossier.owner_id=repository.owner_id AND dossier.wiki_manifest IS NOT NULL
     JOIN repository_wiki_pages page ON page.dossier_id=dossier.id
     JOIN repository_wiki_projection_pages projected ON projected.projection_id=projection.id AND projected.page_id=page.id AND projected.dossier_id=dossier.id
     JOIN repository_wiki_citations citation ON citation.page_id=page.id AND citation.dossier_id=dossier.id AND citation.revision_id=revision.id
     WHERE repository.owner_id=$1 AND repository.disabled_at IS NULL AND repository.visibility=ANY($2::visibility[])
       AND (to_tsvector('simple',page.title || ' ' || coalesce(projected.edited_markdown,page.generated_markdown)) @@ websearch_to_tsquery('simple',$3)
            OR page.title ILIKE $4 ESCAPE '\\' OR coalesce(projected.edited_markdown,page.generated_markdown) ILIKE $4 ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM unnest($6::text[]) entity_term WHERE lower(repository.display_name) LIKE '%' || lower(entity_term) || '%'))
     ORDER BY score DESC,repository.updated_at DESC,page.sort_order,citation.rank
     LIMIT $5`,
    [ownerId, allowedVisibilities(consumer), searchQuery, escapeLikePattern(query.query), query.limit * 64, entityTerms],
  );
  const groupedRepositories = new Map<string, Map<string, { row: RepositoryWikiRow; citations: RepositoryWikiRow[] }>>();
  for (const row of repositories.rows) {
    const pages = groupedRepositories.get(row.repositoryId) ?? new Map();
    const current = pages.get(row.repositoryWikiPageId) ?? { row, citations: [] };
    current.citations.push(row);
    pages.set(row.repositoryWikiPageId, current);
    groupedRepositories.set(row.repositoryId, pages);
  }
  const wikiEvidence: RetrievedRepositoryEvidence[] = [];
  for (const pages of groupedRepositories.values()) {
    const firstPage = pages.values().next().value as { row: RepositoryWikiRow; citations: RepositoryWikiRow[] } | undefined;
    if (!firstPage) continue;
    const terms = repositoryContentTerms(query.query, firstPage.row.repositoryTitle);
    const matchedSections = [...pages.values()].flatMap((page) => repositoryWikiSections(page.row.markdown)
      .filter((section) => terms.length > 0 && terms.some((term) => `${section.heading}\n${section.body}`.toLocaleLowerCase().includes(term)))
      .map((section) => ({ ...page, section })));
    const selectedSections = matchedSections.length > 0
      ? matchedSections
      : repositoryWikiSections(firstPage.row.markdown).slice(0, 1).map((section) => ({ ...firstPage, section }));
    for (const { row, citations, section } of selectedSections) {
      const content = `## ${section.heading}\n${section.body}`;
      const markers = new Set(repositoryWikiMarkers(content));
      const sourceCitations = citations
        .filter((citation) => markers.has(citation.marker))
        .sort((left, right) => left.citationRank - right.citationRank)
        .map((citation) => ({
          marker: citation.marker,
          path: citation.path,
          lineStart: citation.lineStart,
          lineEnd: citation.lineEnd,
          contentHash: citation.contentHash,
        }));
      if (sourceCitations.length === 0) continue;
      wikiEvidence.push({
        repositoryWikiPageId: row.repositoryWikiPageId,
        repositoryId: row.repositoryId,
        repositoryTitle: row.repositoryTitle,
        wikiPagePath: row.wikiPagePath,
        wikiPageTitle: row.wikiPageTitle,
        sectionHeading: section.heading,
        revisionId: row.revisionId,
        commitSha: row.commitSha,
        visibility: row.visibility,
        content,
        score: sectionScore(content, terms, row.score),
        sourceCitations,
      });
    }
  }
  return [...documents, ...wikiEvidence]
    .sort((left, right) => right.score - left.score)
    .slice(0, query.limit);
}
