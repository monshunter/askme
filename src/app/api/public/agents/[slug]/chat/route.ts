import type { NextRequest } from "next/server";

import { apiData, apiFailure, requestId } from "@/server/http";
import { chatPublicAgent, loadPublicThread } from "@/server/public-chat/public-chat-service";
import { parsePublicChatInput } from "@/server/public-chat/public-chat-input";
import { requestVisitorToken } from "@/server/public-chat/visitor-credential";
import { AppError } from "@/server/errors";
import { parsePublicSlug } from "@/server/publication/publication-policy";
import { getRequestLocale } from "@/i18n/server";

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const id = requestId(request);
  try {
    const slug = parsePublicSlug((await context.params).slug);
    return apiData(await loadPublicThread(slug, requestVisitorToken(request), await getRequestLocale()), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const id = requestId(request);
  try {
    const slug = parsePublicSlug((await context.params).slug);
    if (Number(request.headers.get("content-length") ?? 0) > 8_192) throw new AppError("CHAT_REQUEST_TOO_LARGE", "The chat request is too large.", 413);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "Send a valid JSON chat request.", 400);
    }
    const result = await chatPublicAgent(slug, requestVisitorToken(request), parsePublicChatInput(body), id);
    return apiData(result, id, "analysisRun" in result ? { status: 202 } : undefined);
  } catch (error) {
    return apiFailure(error, id);
  }
}
