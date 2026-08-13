import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";
import { rerunCandidateRepositoryAnalysis } from "@/server/repositories/repository-service";
import { requireResourceId } from "@/server/resource-id";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ repositoryId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const repositoryId = requireResourceId((await context.params).repositoryId, "repository");
    return apiData(await rerunCandidateRepositoryAnalysis(user.id, repositoryId, id), id, { status: 202 });
  } catch (error) {
    return apiFailure(error, id);
  }
}
