import type { NextRequest } from "next/server";

import { apiData, apiFailure, requestId } from "@/server/http";
import { refreshPublicSuggestions } from "@/server/public-chat/session-service";
import { requestVisitorToken } from "@/server/public-chat/visitor-credential";
import { parsePublicSlug } from "@/server/publication/publication-policy";
import { getRequestLocale } from "@/i18n/server";
import { AppError } from "@/server/errors";
import { requireResourceId } from "@/server/resource-id";

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const id = requestId(request);
  try {
    const slug = parsePublicSlug((await context.params).slug);
    let body: unknown;
    try { body = await request.json(); } catch { throw new AppError("INVALID_JSON", "Send a valid conversation identifier.", 400); }
    const conversationId = requireResourceId(body && typeof body === "object" && "conversationId" in body ? String(body.conversationId) : "", "conversation");
    return apiData(await refreshPublicSuggestions(slug, requestVisitorToken(request), conversationId, await getRequestLocale()), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
