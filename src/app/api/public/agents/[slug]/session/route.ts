import type { NextRequest } from "next/server";

import { apiData, apiFailure, requestId, requestOrigin } from "@/server/http";
import { openPublicSession } from "@/server/public-chat/session-service";
import { requestClientAddress, requestSessionVisitorToken, visitorCookieName } from "@/server/public-chat/visitor-credential";
import { parsePublicSlug } from "@/server/publication/publication-policy";
import { PUBLIC_VISITOR_COOKIE } from "@/shared/public-visitor";

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const id = requestId(request);
  try {
    const slug = parsePublicSlug((await context.params).slug);
    const legacyCookieName = visitorCookieName(slug);
    const session = await openPublicSession(slug, requestSessionVisitorToken(request, slug), requestClientAddress(request.headers), id);
    const response = apiData({ conversationId: session.conversation.id, expiresAt: session.conversation.expiresAt, created: session.created, visitorToken: session.token }, id);
    response.cookies.delete(legacyCookieName);
    response.cookies.set(PUBLIC_VISITOR_COOKIE, session.token, {
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
