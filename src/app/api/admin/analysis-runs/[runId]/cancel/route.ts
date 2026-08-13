import type { NextRequest } from "next/server";

import { parseAnalysisRunActionInput } from "@/server/admin/admin-input";
import { cancelAdminAnalysisRun } from "@/server/admin/repository-analysis-service";
import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";
import { requireResourceId } from "@/server/resource-id";

export async function POST(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const id = requestId(request);
  try {
    const admin = await requireRequestUser(request, ["admin"]);
    if (Number(request.headers.get("content-length") ?? 0) > 4_096) throw new AppError("ADMIN_REQUEST_TOO_LARGE", "The governance request is too large.", 413);
    let body: unknown;
    try { body = await request.json(); } catch { throw new AppError("INVALID_JSON", "Send a valid JSON governance request.", 400); }
    const runId = requireResourceId((await context.params).runId, "analysis_run");
    return apiData(await cancelAdminAnalysisRun(admin.id, runId, parseAnalysisRunActionInput(body), id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
