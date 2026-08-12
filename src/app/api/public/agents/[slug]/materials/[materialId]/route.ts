import type { NextRequest } from "next/server";

import { apiFailure, requestId, withRequestId } from "@/server/http";
import { getPublicMaterialContent, materialContentResponse } from "@/server/materials/material-content-service";
import { parsePublicSlug } from "@/server/publication/publication-policy";
import { requireResourceId } from "@/server/resource-id";

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string; materialId: string }> }) {
  const id = requestId(request);
  try {
    const params = await context.params;
    const slug = parsePublicSlug(params.slug);
    const materialId = requireResourceId(params.materialId, "material");
    return withRequestId(materialContentResponse(await getPublicMaterialContent(slug, materialId), "no-store"), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
