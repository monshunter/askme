import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";
import { parseRepositorySyncInput } from "@/server/repositories/repository-input";
import { createAndSyncCandidateRepository, listCandidateRepositories } from "@/server/repositories/repository-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    return apiData(await listCandidateRepositories(user.id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    if (Number(request.headers.get("content-length") ?? 0) > 32 * 1024) throw new AppError("REPOSITORY_SYNC_REQUEST_TOO_LARGE", "The Repository sync request is too large.", 413);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "Send a valid JSON Repository sync request.", 400);
    }
    const input = parseRepositorySyncInput(body);
    return apiData(await createAndSyncCandidateRepository(user.id, input, id), id, { status: 201 });
  } catch (error) {
    return apiFailure(error, id);
  }
}
