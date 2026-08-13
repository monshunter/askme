import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";
import { updateCandidateWikiProjectionPage } from "@/server/repositories/dossier-review-service";
import { parseWikiProjectionPageInput } from "@/server/repositories/repository-input";
import { requireResourceId } from "@/server/resource-id";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ repositoryId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const repositoryId = requireResourceId((await context.params).repositoryId, "repository");
    if (Number(request.headers.get("content-length") ?? 0) > 520 * 1024) throw new AppError("WIKI_PROJECTION_REQUEST_TOO_LARGE", "The Repository Wiki page request is too large.", 413);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "Send a valid JSON Repository Wiki projection request.", 400);
    }
    return apiData(await updateCandidateWikiProjectionPage({ pool: getPool(), ownerId: user.id, repositoryId, change: parseWikiProjectionPageInput(body), requestId: id }), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
