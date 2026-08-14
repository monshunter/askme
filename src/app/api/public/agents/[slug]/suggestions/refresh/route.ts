import type { NextRequest } from "next/server";

import { apiData, apiFailure, requestId } from "@/server/http";
import { refreshPublicSuggestions } from "@/server/public-chat/session-service";
import { requestVisitorToken } from "@/server/public-chat/visitor-credential";
import { parsePublicSlug } from "@/server/publication/publication-policy";
import { getRequestLocale } from "@/i18n/server";

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const id = requestId(request);
  try {
    const slug = parsePublicSlug((await context.params).slug);
    return apiData(await refreshPublicSuggestions(slug, requestVisitorToken(request), await getRequestLocale()), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
