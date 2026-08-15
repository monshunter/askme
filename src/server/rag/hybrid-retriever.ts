import type { Pool } from "pg";

import { EmbeddingClient } from "@/server/ai/retrieval-providers";
import type { RuntimeConfig } from "@/server/config";
import { allowedVisibilities, type MaterialVisibility, type VisibilityConsumer } from "@/server/privacy/visibility-policy";

import type { EntityScope } from "./entity-catalog";
import type { RagQueryPlan } from "./query-planner";

export type RagRoute = "exact" | "lexical" | "vector" | "structured";

export type RagRouteHit = {
  evidenceId: string;
  parentId: string;
  stableKey: string;
  sourceVersionId: string;
  indexVersionId: string;
  sourceKind: "material" | "approved_wiki" | "repository_markdown" | "repository_pdf";
  sourceId: string;
  repositoryId: string | null;
  sourceRevision: string;
  evidenceFamilyId: string;
  visibility: MaterialVisibility;
  title: string;
  path: string | null;
  commitSha: string | null;
  revisionId: string | null;
  sourceContentHash: string | null;
  structurePath: string;
  content: string;
  parentContent: string;
  tokenCount: number;
  sourceRange: { lineStart?: number; lineEnd?: number; page?: number; forcedSplit?: boolean };
  contentChecksum: string;
};

export type RetrievedRagEvidence = RagRouteHit & {
  score: number;
  rrfScore: number;
  routeRanks: Partial<Record<RagRoute, number>>;
  rerankScore?: number;
};

export type HybridRetrievalResult = {
  candidates: RetrievedRagEvidence[];
  routeCounts: Record<RagRoute, number>;
  degradations: string[];
};

type RouteMap = Record<RagRoute, RagRouteHit[]>;
type Queryable = Pick<Pool, "query">;
type EmbeddingProvider = Pick<EmbeddingClient, "embed">;

const eligibleCte = `
WITH eligible AS (
  SELECT child.id AS "evidenceId",child.parent_id AS "parentId",child.stable_key AS "stableKey",
         source.id AS "sourceVersionId",source.index_version_id AS "indexVersionId",source.source_kind AS "sourceKind",
         source.source_id AS "sourceId",source.metadata->>'repositoryId' AS "repositoryId",source.source_revision AS "sourceRevision",source.evidence_family_id AS "evidenceFamilyId",
         coalesce(material.visibility,repository.visibility) AS visibility,
         coalesce(material.title,source.metadata->>'repositoryTitle',source.metadata->>'title','Evidence') AS title,
         source.metadata->>'path' AS path,source.metadata->>'commitSha' AS "commitSha",source.metadata->>'revisionId' AS "revisionId",
         source.metadata->>'contentHash' AS "sourceContentHash",
         parent.structure_path AS "structurePath",child.content,parent.content AS "parentContent",child.contextual_content AS "contextualContent",
         parent.token_count AS "tokenCount",parent.source_range AS "sourceRange",child.content_checksum AS "contentChecksum",
         child.search_vector,child.embedding,source.metadata
  FROM rag_child_chunks child
  JOIN rag_parent_chunks parent ON parent.id=child.parent_id AND parent.owner_id=child.owner_id
    AND parent.index_version_id=child.index_version_id AND parent.source_version_id=child.source_version_id
  JOIN rag_source_versions source ON source.id=child.source_version_id AND source.owner_id=child.owner_id
    AND source.index_version_id=child.index_version_id AND source.state='active'
  JOIN rag_index_versions version ON version.id=child.index_version_id AND version.state='active'
  LEFT JOIN materials material ON source.source_kind='material' AND material.id=source.source_id AND material.owner_id=source.owner_id
  LEFT JOIN repositories repository ON source.source_kind<>'material' AND repository.owner_id=source.owner_id
    AND ((source.source_kind IN ('repository_markdown','repository_pdf') AND repository.id=source.source_id)
      OR (source.source_kind='approved_wiki' AND repository.id::text=source.metadata->>'repositoryId'))
  WHERE child.owner_id=$1
    AND (
      (source.source_kind='material' AND material.status='indexed' AND material.content_checksum=source.source_revision
        AND material.visibility=ANY($2::visibility[]))
      OR
      (source.source_kind IN ('repository_markdown','repository_pdf') AND repository.disabled_at IS NULL
        AND repository.visibility=ANY($2::visibility[]) AND repository.rag_index_state IN ('ready','ready_with_warnings')
        AND repository.rag_index_commit_sha=source.metadata->>'commitSha'
        AND EXISTS (
          SELECT 1 FROM repository_revisions revision
          WHERE revision.id=repository.active_revision_id AND revision.repository_id=repository.id
            AND revision.owner_id=repository.owner_id AND revision.state='stored' AND revision.commit_sha=source.metadata->>'commitSha'
        ))
      OR
      (source.source_kind='approved_wiki' AND repository.disabled_at IS NULL AND repository.visibility=ANY($2::visibility[])
        AND EXISTS (
          SELECT 1 FROM repository_revisions revision
          JOIN repository_dossiers dossier ON dossier.revision_id=revision.id AND dossier.owner_id=repository.owner_id
          JOIN repository_dossier_projections projection ON projection.id=repository.active_projection_id
            AND projection.dossier_id=dossier.id AND projection.state='approved'
          JOIN repository_wiki_pages page ON page.id=source.source_id AND page.dossier_id=dossier.id
          JOIN repository_wiki_projection_pages projected ON projected.projection_id=projection.id
            AND projected.page_id=page.id AND projected.dossier_id=dossier.id
          WHERE revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id
        ))
    )
    AND (
      $3::uuid[] IS NULL
      OR (source.source_kind='material' AND source.source_id=ANY($3::uuid[]))
      OR (source.source_kind<>'material' AND repository.id=ANY($4::uuid[]))
    )
)`;

const selectedColumns = `"evidenceId","parentId","stableKey","sourceVersionId","indexVersionId","sourceKind","sourceId","repositoryId","sourceRevision","evidenceFamilyId",visibility,title,path,"commitSha","revisionId","sourceContentHash","structurePath",content,"parentContent","tokenCount","sourceRange","contentChecksum"`;

function likePatterns(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].map((value) => `%${value.replace(/[\\%_]/gu, "\\$&")}%`).slice(0, 48);
}

function ftsQuery(values: string[]) {
  const terms = [...new Set(values.map((value) => value.normalize("NFKC").replace(/[^\p{L}\p{N}_]/gu, "").toLocaleLowerCase("en-US")).filter(Boolean))].slice(0, 48);
  return (terms.length > 0 ? terms : ["evidence"]).map((term) => `${term}:*`).join(" | ");
}

function vectorLiteral(vector: number[]) {
  return `[${vector.join(",")}]`;
}

function deduplicateRoute(hits: RagRouteHit[]) {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (seen.has(hit.evidenceId)) return false;
    seen.add(hit.evidenceId);
    return true;
  });
}

function routeScopeValues(scope: EntityScope | null | undefined) {
  return scope ? [scope.materialIds, scope.repositoryIds] as const : [null, null] as const;
}

export function fuseWeightedRrf(
  routes: RouteMap,
  config: { exact: number; lexical: number; vector: number; structured: number; rrfK: number; maxChildrenPerParent: number },
): RetrievedRagEvidence[] {
  const fused = new Map<string, RetrievedRagEvidence>();
  for (const route of ["exact", "lexical", "vector", "structured"] as const) {
    deduplicateRoute(routes[route]).forEach((hit, index) => {
      const rank = index + 1;
      const current = fused.get(hit.evidenceId) ?? { ...hit, score: 0, rrfScore: 0, routeRanks: {} };
      current.rrfScore += config[route] / (config.rrfK + rank);
      current.score = current.rrfScore;
      current.routeRanks[route] = rank;
      fused.set(hit.evidenceId, current);
    });
  }
  const parentCounts = new Map<string, number>();
  return [...fused.values()]
    .sort((left, right) => right.rrfScore - left.rrfScore || left.evidenceId.localeCompare(right.evidenceId))
    .filter((candidate) => {
      const count = parentCounts.get(candidate.parentId) ?? 0;
      if (count >= config.maxChildrenPerParent) return false;
      parentCounts.set(candidate.parentId, count + 1);
      return true;
    });
}

async function exactRoute(pool: Queryable, ownerId: string, visibility: readonly MaterialVisibility[], plan: RagQueryPlan, limit: number, scope?: EntityScope | null) {
  const phrases = [...plan.exactPhrases, ...plan.entities, plan.standaloneQuery].slice(0, 32);
  const result = await pool.query<RagRouteHit>(
    `${eligibleCte}
     /* rag-route:exact */
     SELECT ${selectedColumns}
     FROM eligible
     WHERE "contextualContent" ILIKE ANY($5::text[]) OR metadata::text ILIKE ANY($5::text[])
     ORDER BY (SELECT count(*) FROM unnest($6::text[]) phrase WHERE lower("contextualContent") LIKE '%' || lower(phrase) || '%') DESC,
              "evidenceId" ASC
     LIMIT $7`,
    [ownerId, visibility, ...routeScopeValues(scope), likePatterns(phrases), phrases, limit],
  );
  return result.rows;
}

async function lexicalRoute(pool: Queryable, ownerId: string, visibility: readonly MaterialVisibility[], plan: RagQueryPlan, limit: number, scope?: EntityScope | null) {
  const probes = [...plan.trigramProbes, ...plan.lexicalTerms].slice(0, 32);
  const result = await pool.query<RagRouteHit>(
    `${eligibleCte}
     /* rag-route:lexical */
     SELECT ${selectedColumns}
     FROM eligible
     WHERE search_vector @@ to_tsquery('simple',$5) OR content ILIKE ANY($6::text[])
       OR EXISTS (SELECT 1 FROM unnest($7::text[]) probe WHERE similarity(content,probe)>=0.08)
     ORDER BY (ts_rank_cd(search_vector,to_tsquery('simple',$5))
       + coalesce((SELECT max(similarity(content,probe)) FROM unnest($7::text[]) probe),0)) DESC,"evidenceId" ASC
     LIMIT $8`,
    [ownerId, visibility, ...routeScopeValues(scope), ftsQuery(plan.lexicalTerms), likePatterns(probes), probes, limit],
  );
  return result.rows;
}

async function structuredRoute(pool: Queryable, ownerId: string, visibility: readonly MaterialVisibility[], plan: RagQueryPlan, limit: number, scope?: EntityScope | null) {
  const probes = likePatterns([...plan.entities, ...plan.mustTerms, ...plan.shouldTerms]);
  const result = await pool.query<RagRouteHit>(
    `${eligibleCte}
     /* rag-route:structured */
     SELECT ${selectedColumns}
     FROM eligible
     WHERE title ILIKE ANY($5::text[]) OR coalesce(path,'') ILIKE ANY($5::text[])
       OR ("sourceKind"='material' AND EXISTS (
         SELECT 1 FROM knowledge_sources anchor
         JOIN knowledge_items knowledge ON knowledge.id=anchor.knowledge_item_id AND knowledge.owner_id=anchor.owner_id AND knowledge.status='active'
         WHERE anchor.owner_id=$1 AND anchor.material_id="sourceId"
           AND (knowledge.title ILIKE ANY($5::text[]) OR knowledge.summary ILIKE ANY($5::text[])
             OR knowledge.entities::text ILIKE ANY($5::text[]))
       ))
     ORDER BY "evidenceId" ASC LIMIT $6`,
    [ownerId, visibility, ...routeScopeValues(scope), probes.length > 0 ? probes : likePatterns([plan.standaloneQuery]), limit],
  );
  return result.rows;
}

async function vectorRoute(pool: Queryable, ownerId: string, visibility: readonly MaterialVisibility[], vector: number[], limit: number, scope?: EntityScope | null) {
  const result = await pool.query<RagRouteHit>(
    `${eligibleCte}
     /* rag-route:vector */
     SELECT ${selectedColumns}
     FROM eligible
     ORDER BY embedding <=> $5::vector,"evidenceId" ASC LIMIT $6`,
    [ownerId, visibility, ...routeScopeValues(scope), vectorLiteral(vector), limit],
  );
  return result.rows;
}

export async function retrieveHybridEvidence(
  pool: Queryable,
  ownerId: string,
  consumer: VisibilityConsumer,
  plan: RagQueryPlan,
  config: RuntimeConfig,
  dependencies: { embeddingClient?: EmbeddingProvider; scope?: EntityScope | null } = {},
): Promise<HybridRetrievalResult> {
  const visibility = allowedVisibilities(consumer);
  const retrieval = config.rag.retrieval;
  const embeddingClient = dependencies.embeddingClient ?? new EmbeddingClient(config.embedding);
  const vectorPromise = embeddingClient.embed(plan.semanticQueries.slice(0, 2))
    .then(async (embedded) => {
      const batches = await Promise.all(embedded.vectors.map((vector) => vectorRoute(pool, ownerId, visibility, vector, retrieval.vectorTopK, dependencies.scope)));
      return { hits: deduplicateRoute(batches.flat()), degraded: false };
    })
    .catch(() => ({ hits: [] as RagRouteHit[], degraded: true }));
  const [exact, lexical, structured, vector] = await Promise.all([
    exactRoute(pool, ownerId, visibility, plan, retrieval.exactTopK, dependencies.scope),
    lexicalRoute(pool, ownerId, visibility, plan, retrieval.lexicalTopK, dependencies.scope),
    structuredRoute(pool, ownerId, visibility, plan, retrieval.structuredTopK, dependencies.scope),
    vectorPromise,
  ]);
  const routes: RouteMap = { exact, lexical, vector: vector.hits, structured };
  const candidates = fuseWeightedRrf(routes, {
    exact: retrieval.exactWeight,
    lexical: retrieval.lexicalWeight,
    vector: retrieval.vectorWeight,
    structured: retrieval.structuredWeight,
    rrfK: retrieval.rrfK,
    maxChildrenPerParent: retrieval.maxChildrenPerParent,
  });
  return {
    candidates,
    routeCounts: { exact: exact.length, lexical: lexical.length, vector: vector.hits.length, structured: structured.length },
    degradations: vector.degraded ? ["embedding_fallback"] : [],
  };
}
