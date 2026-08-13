import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { getRuntimeConfig } from "@/server/config";
import { getPool } from "@/server/db/client";
import { apiData, apiFailure, requestId } from "@/server/http";
import { loadRepositorySourcePreview, parseRepositorySourceQuery } from "@/server/repositories/source-preview";
import { requireResourceId } from "@/server/resource-id";

export async function GET(request: NextRequest, context: { params: Promise<{ repositoryId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const repositoryId = requireResourceId((await context.params).repositoryId, "repository");
    const response = apiData(await loadRepositorySourcePreview({
      pool: getPool(), artifactRoot: getRuntimeConfig().repositoryArtifactRoot, repositoryId,
      citation: parseRepositorySourceQuery(request.nextUrl), authorization: { mode: "candidate", ownerId: user.id },
    }), id);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch (error) {
    return apiFailure(error, id);
  }
}
