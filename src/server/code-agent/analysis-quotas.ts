import type { Pool, PoolClient } from "pg";

import type { RuntimeConfig } from "@/server/config";
import { AppError } from "@/server/errors";

export type AnalysisQuotaScope = { type: keyof RuntimeConfig["codeAgent"]["dailyQuotas"]; key: string };

export async function analysisQuotaScopesAvailable(
  pool: Pool,
  config: RuntimeConfig["codeAgent"],
  scopes: AnalysisQuotaScope[],
) {
  const windowStartedAt = new Date();
  windowStartedAt.setUTCHours(0, 0, 0, 0);
  for (const scope of scopes) {
    if (!scope.key || scope.key.length > 200) return false;
    const result = await pool.query<{ used: number }>(
      `SELECT used FROM analysis_quota_usage WHERE scope_type=$1 AND scope_key=$2 AND window_started_at=$3`,
      [scope.type, scope.key, windowStartedAt],
    );
    if ((result.rows[0]?.used ?? 0) >= config.dailyQuotas[scope.type]) return false;
  }
  return true;
}

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
