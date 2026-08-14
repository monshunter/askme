import type { PoolClient } from "pg";

import type { RuntimeConfig } from "@/server/config";
import { AppError } from "@/server/errors";

type AnalysisQuotaScope = { type: keyof RuntimeConfig["codeAgent"]["dailyQuotas"]; key: string };

export async function consumeAnalysisDailyQuotas(
  client: PoolClient,
  config: RuntimeConfig["codeAgent"],
  scopes: AnalysisQuotaScope[],
) {
  const windowStartedAt = new Date();
  windowStartedAt.setUTCHours(0, 0, 0, 0);
  for (const scope of scopes) {
    const limit = config.dailyQuotas[scope.type];
    if (!scope.key || scope.key.length > 200) throw new AppError("ANALYSIS_QUOTA_SCOPE_INVALID", "The Analysis quota scope is invalid.", 500);
    const consumed = await client.query<{ used: number }>(
      `INSERT INTO analysis_quota_usage(scope_type,scope_key,window_started_at,used)
       VALUES ($1,$2,$3,1)
       ON CONFLICT(scope_type,scope_key,window_started_at) DO UPDATE
         SET used=analysis_quota_usage.used+1,updated_at=now()
         WHERE analysis_quota_usage.used<$4
       RETURNING used`,
      [scope.type, scope.key, windowStartedAt, limit],
    );
    if (!consumed.rows[0]) {
      throw new AppError(`ANALYSIS_QUOTA_${scope.type.toUpperCase()}_EXCEEDED`, "The Code Agent daily quota has been reached for this scope.", 429, { scope: scope.type });
    }
  }
}
