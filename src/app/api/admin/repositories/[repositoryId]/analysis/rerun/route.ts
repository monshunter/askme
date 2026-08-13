import type { NextRequest } from "next/server";

import { rerunAdminRepositoryAnalysis } from "@/server/admin/repository-analysis-service";
import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";
import { requireResourceId } from "@/server/resource-id";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ repositoryId: string }> }) {
  const id = requestId(request);
  try {
    const admin = await requireRequestUser(request, ["admin"]);
    const repositoryId = requireResourceId((await context.params).repositoryId, "repository");
    return apiData(await rerunAdminRepositoryAnalysis(admin.id, repositoryId, id), id, { status: 202 });
  } catch (error) {
    return apiFailure(error, id);
  }
}
