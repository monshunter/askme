import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { getRuntimeConfig } from "@/server/config";
import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";
import { approveCandidateRepositoryDossier } from "@/server/repositories/dossier-review-service";
import { parseDossierApprovalInput } from "@/server/repositories/repository-input";
import { requireResourceId } from "@/server/resource-id";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ repositoryId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const repositoryId = requireResourceId((await context.params).repositoryId, "repository");
    if (Number(request.headers.get("content-length") ?? 0) > 4 * 1024) throw new AppError("DOSSIER_APPROVAL_REQUEST_TOO_LARGE", "The Dossier approval request is too large.", 413);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "Send a valid Dossier approval request.", 400);
    }
    const approval = parseDossierApprovalInput(body);
    return apiData(await approveCandidateRepositoryDossier({
      pool: getPool(),
      artifactRoot: getRuntimeConfig().repositoryArtifactRoot,
      ownerId: user.id,
      repositoryId,
      dossierId: approval.dossierId,
      requestId: id,
    }), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
