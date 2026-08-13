import type { NextRequest } from "next/server";

import { parseRepositoryActionInput } from "@/server/admin/admin-input";
import { governAdminRepository } from "@/server/admin/repository-analysis-service";
import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";
import { requireResourceId } from "@/server/resource-id";

export async function PATCH(request: NextRequest, context: { params: Promise<{ repositoryId: string }> }) {
  const id = requestId(request);
  try {
    const admin = await requireRequestUser(request, ["admin"]);
    if (Number(request.headers.get("content-length") ?? 0) > 4_096) throw new AppError("ADMIN_REQUEST_TOO_LARGE", "The governance request is too large.", 413);
    let body: unknown;
    try { body = await request.json(); } catch { throw new AppError("INVALID_JSON", "Send a valid JSON governance request.", 400); }
    const repositoryId = requireResourceId((await context.params).repositoryId, "repository");
    return apiData(await governAdminRepository(admin.id, repositoryId, parseRepositoryActionInput(body), id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
