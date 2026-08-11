import type { NextRequest } from "next/server";

import { apiData, apiFailure, requestId } from "@/server/http";
import { chatPublicAgent, loadPublicThread } from "@/server/public-chat/public-chat-service";
import { parsePublicChatInput } from "@/server/public-chat/public-chat-input";
import { visitorCookieName } from "@/server/public-chat/visitor-credential";
import { AppError } from "@/server/errors";
import { parsePublicSlug } from "@/server/publication/publication-policy";

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const id = requestId(request);
  try {
    const slug = parsePublicSlug((await context.params).slug);
    return apiData(await loadPublicThread(slug, request.cookies.get(visitorCookieName(slug))?.value), id);
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
    return apiData(await chatPublicAgent(slug, request.cookies.get(visitorCookieName(slug))?.value, parsePublicChatInput(body), id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
