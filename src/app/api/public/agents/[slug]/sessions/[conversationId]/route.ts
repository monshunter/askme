import type { NextRequest } from "next/server";

import { apiData, apiFailure, requestId } from "@/server/http";
import { deletePublicSession } from "@/server/public-chat/session-service";
import { requestVisitorToken } from "@/server/public-chat/visitor-credential";
import { parsePublicSlug } from "@/server/publication/publication-policy";
import { requireResourceId } from "@/server/resource-id";

export async function DELETE(request: NextRequest, context: { params: Promise<{ slug: string; conversationId: string }> }) {
  const id = requestId(request);
  try {
    const params = await context.params;
    const slug = parsePublicSlug(params.slug);
    const conversationId = requireResourceId(params.conversationId, "conversation");
    return apiData(await deletePublicSession(slug, requestVisitorToken(request), conversationId, id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
