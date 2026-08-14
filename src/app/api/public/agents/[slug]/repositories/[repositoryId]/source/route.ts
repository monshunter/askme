import type { NextRequest } from "next/server";

import { getRuntimeConfig } from "@/server/config";
import { getPool } from "@/server/db/client";
import { apiData, apiFailure, requestId } from "@/server/http";
import { requirePublicConversation } from "@/server/public-chat/session-service";
import { requestVisitorToken } from "@/server/public-chat/visitor-credential";
import { parsePublicSlug } from "@/server/publication/publication-policy";
import { loadRepositorySourcePreview, parseRepositorySourceQuery } from "@/server/repositories/source-preview";
import { requireResourceId } from "@/server/resource-id";

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string; repositoryId: string }> }) {
  const id = requestId(request);
  try {
    const params = await context.params;
    const slug = parsePublicSlug(params.slug);
    const conversationId = requireResourceId(request.nextUrl.searchParams.get("conversationId") ?? "", "conversation");
    const repositoryId = requireResourceId(params.repositoryId, "repository");
    const { publication, conversation } = await requirePublicConversation(slug, requestVisitorToken(request), conversationId);
    const citationUrl = new URL(request.nextUrl);
    citationUrl.searchParams.delete("conversationId");
    const response = apiData(await loadRepositorySourcePreview({
      pool: getPool(), artifactRoot: getRuntimeConfig().repositoryArtifactRoot, repositoryId,
      citation: parseRepositorySourceQuery(citationUrl),
      authorization: { mode: "public", ownerId: conversation.ownerId, conversationId: conversation.id, publicationId: publication.publicationId },
    }), id);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch (error) {
    return apiFailure(error, id);
  }
}
