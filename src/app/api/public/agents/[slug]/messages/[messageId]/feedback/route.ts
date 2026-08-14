import type { NextRequest } from "next/server";

import { apiData, apiFailure, requestId } from "@/server/http";
import { parsePublicFeedbackInput } from "@/server/public-chat/public-chat-input";
import { savePublicFeedback } from "@/server/public-chat/public-chat-service";
import { requestVisitorToken } from "@/server/public-chat/visitor-credential";
import { AppError } from "@/server/errors";
import { parsePublicSlug } from "@/server/publication/publication-policy";
import { requireResourceId } from "@/server/resource-id";

export async function PUT(request: NextRequest, context: { params: Promise<{ slug: string; messageId: string }> }) {
  const id = requestId(request);
  try {
    const params = await context.params;
    const slug = parsePublicSlug(params.slug);
    const messageId = requireResourceId(params.messageId, "message");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "Send valid JSON feedback.", 400);
    }
    return apiData(await savePublicFeedback(slug, requestVisitorToken(request), messageId, parsePublicFeedbackInput(body), id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
