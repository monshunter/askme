import type { Pool } from "pg";

import type { RuntimeConfig } from "@/server/config";
import { analysisQuotaScopesAvailable, type AnalysisQuotaScope } from "@/server/code-agent/analysis-quotas";

import type { QuestionRouteRepository } from "./question-router";

type QuestionRepositoryRow = {
  id: string;
  displayName: string;
  publicDeepAnalysisEnabled: boolean;
};

export async function loadQuestionRepositories(input: {
  pool: Pool;
  config: RuntimeConfig;
  ownerId: string;
  mode: "candidate" | "public";
  publicationId?: string;
  visitorKey?: string;
}): Promise<QuestionRouteRepository[]> {
  const rows = await input.pool.query<QuestionRepositoryRow>(
    `SELECT repository.id,repository.display_name AS "displayName",repository.public_deep_analysis_enabled AS "publicDeepAnalysisEnabled"
     FROM repositories repository
     JOIN repository_revisions revision ON revision.id=repository.active_revision_id AND revision.owner_id=repository.owner_id AND revision.state='stored'
     JOIN repository_dossier_projections projection ON projection.id=repository.active_projection_id AND projection.state='approved'
     JOIN repository_dossiers dossier ON dossier.id=projection.dossier_id AND dossier.revision_id=revision.id AND dossier.owner_id=repository.owner_id
     WHERE repository.owner_id=$1 AND repository.disabled_at IS NULL
       AND repository.visibility=ANY($2::visibility[])
     ORDER BY repository.display_name,repository.id`,
    [input.ownerId, input.mode === "candidate" ? ["agent_only", "citation_allowed", "public_preview"] : ["citation_allowed", "public_preview"]],
  );
  const commonScopes: AnalysisQuotaScope[] = [
    { type: "global", key: "global" },
    { type: "candidate", key: input.ownerId },
  ];
  if (input.mode === "public") {
    if (input.publicationId) commonScopes.push({ type: "publication", key: input.publicationId });
    if (input.visitorKey) commonScopes.push({ type: "visitor", key: input.visitorKey });
  }
  const commonAvailable = await analysisQuotaScopesAvailable(input.pool, input.config.codeAgent, commonScopes);
  return Promise.all(rows.rows.map(async (repository) => ({
    id: repository.id,
    displayName: repository.displayName,
    deepAllowed: commonAvailable
      && (input.mode === "candidate" || repository.publicDeepAnalysisEnabled)
      && await analysisQuotaScopesAvailable(input.pool, input.config.codeAgent, [{ type: "repository", key: repository.id }]),
  })));
}
