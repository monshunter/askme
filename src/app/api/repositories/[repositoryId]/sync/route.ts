import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";
import { parseRepositoryResyncInput } from "@/server/repositories/repository-input";
import { resyncCandidateRepository } from "@/server/repositories/repository-service";
import { requireResourceId } from "@/server/resource-id";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ repositoryId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const repositoryId = requireResourceId((await context.params).repositoryId, "repository");
    if (Number(request.headers.get("content-length") ?? 0) > 32 * 1024) throw new AppError("REPOSITORY_SYNC_REQUEST_TOO_LARGE", "The Repository sync request is too large.", 413);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "Send a valid JSON Repository sync request.", 400);
    }
    return apiData(await resyncCandidateRepository(user.id, repositoryId, parseRepositoryResyncInput(body), id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
