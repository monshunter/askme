import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { analysisRunSseResponse, type AnalysisRunSnapshot } from "@/server/code-agent/analysis-sse";
import { getPool } from "@/server/db/client";
import { apiFailure, requestId, withRequestId } from "@/server/http";
import { requireResourceId } from "@/server/resource-id";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const runId = requireResourceId((await context.params).runId, "analysis_run");
    const response = await analysisRunSseResponse({
      request,
      pool: getPool(),
      runId,
      loadSnapshot: async (client) => (await client.query<AnalysisRunSnapshot>(
        `SELECT id,version,state,phase,outcome,safe_error_code AS "safeErrorCode",assistant_message_id AS "assistantMessageId"
         FROM analysis_runs WHERE id=$1 AND owner_id=$2`,
        [runId, user.id],
      )).rows[0] ?? null,
    });
    return withRequestId(response, id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
