import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";
import { parseRepositoryPublicDeepInput, parseRepositoryVisibilityInput } from "@/server/repositories/repository-input";
import { updateCandidateRepositoryPublicDeepAnalysis, updateCandidateRepositoryVisibility } from "@/server/repositories/repository-service";
import { requireResourceId } from "@/server/resource-id";

export async function PATCH(request: NextRequest, context: { params: Promise<{ repositoryId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const repositoryId = requireResourceId((await context.params).repositoryId, "repository");
    if (Number(request.headers.get("content-length") ?? 0) > 4_096) throw new AppError("REPOSITORY_VISIBILITY_REQUEST_TOO_LARGE", "The Repository visibility request is too large.", 413);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "Send a valid JSON Repository visibility request.", 400);
    }
    if (body && typeof body === "object" && "publicDeepAnalysisEnabled" in body) {
      const input = parseRepositoryPublicDeepInput(body);
      return apiData(await updateCandidateRepositoryPublicDeepAnalysis(user.id, repositoryId, input.publicDeepAnalysisEnabled, id), id);
    }
    const input = parseRepositoryVisibilityInput(body);
    return apiData(await updateCandidateRepositoryVisibility(user.id, repositoryId, input.visibility, id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
