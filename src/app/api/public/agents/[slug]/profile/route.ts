import type { NextRequest } from "next/server";

import { apiFailure, requestId, withRequestId } from "@/server/http";
import { materialContentResponse } from "@/server/materials/material-content-response";
import { getPublicProfileMaterialContent } from "@/server/materials/material-content-service";
import { parsePublicSlug } from "@/server/publication/publication-policy";

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const id = requestId(request);
  try {
    const slug = parsePublicSlug((await context.params).slug);
    return withRequestId(materialContentResponse(await getPublicProfileMaterialContent(slug), "no-store"), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
