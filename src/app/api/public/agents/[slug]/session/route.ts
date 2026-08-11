import type { NextRequest } from "next/server";

import { apiData, apiFailure, requestId, requestOrigin } from "@/server/http";
import { openPublicSession } from "@/server/public-chat/session-service";
import { requestClientAddress, visitorCookieName } from "@/server/public-chat/visitor-credential";
import { parsePublicSlug } from "@/server/publication/publication-policy";

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const id = requestId(request);
  try {
    const slug = parsePublicSlug((await context.params).slug);
    const cookieName = visitorCookieName(slug);
    const session = await openPublicSession(slug, request.cookies.get(cookieName)?.value, requestClientAddress(request.headers), id);
    const response = apiData({ conversationId: session.conversation.id, expiresAt: session.conversation.expiresAt, created: session.created }, id);
    response.cookies.set(cookieName, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: requestOrigin(request).startsWith("https://"),
      path: "/",
      expires: session.conversation.expiresAt,
    });
    return response;
  } catch (error) {
    return apiFailure(error, id);
  }
}
