import type { NextRequest } from "next/server";

import { apiFailure, requestId, withRequestId } from "@/server/http";
import { getPublicMaterialContent, materialContentResponse } from "@/server/materials/material-content-service";
import { requirePublicConversation } from "@/server/public-chat/session-service";
import { requestVisitorToken } from "@/server/public-chat/visitor-credential";
import { parsePublicSlug } from "@/server/publication/publication-policy";
import { requireResourceId } from "@/server/resource-id";

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string; materialId: string }> }) {
  const id = requestId(request);
  try {
    const params = await context.params;
    const slug = parsePublicSlug(params.slug);
    const conversationId = requireResourceId(request.nextUrl.searchParams.get("conversationId") ?? "", "conversation");
    const materialId = requireResourceId(params.materialId, "material");
    await requirePublicConversation(slug, requestVisitorToken(request), conversationId);
    return withRequestId(materialContentResponse(await getPublicMaterialContent(slug, materialId), "no-store"), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
