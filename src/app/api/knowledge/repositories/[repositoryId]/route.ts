import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { getPool } from "@/server/db/client";
import { apiData, apiFailure, requestId } from "@/server/http";
import { getCandidateActiveRepositoryKnowledge } from "@/server/repositories/dossier-review-service";
import { requireResourceId } from "@/server/resource-id";

export async function GET(request: NextRequest, context: { params: Promise<{ repositoryId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const repositoryId = requireResourceId((await context.params).repositoryId, "repository");
    return apiData(await getCandidateActiveRepositoryKnowledge(getPool(), user.id, repositoryId), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
