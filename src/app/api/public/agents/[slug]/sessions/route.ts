import type { NextRequest } from "next/server";

import { apiData, apiFailure, requestId } from "@/server/http";
import { createPublicSession, listPublicSessions } from "@/server/public-chat/session-service";
import { requestClientAddress, requestVisitorToken } from "@/server/public-chat/visitor-credential";
import { parsePublicSlug } from "@/server/publication/publication-policy";

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const id = requestId(request);
  try {
    const slug = parsePublicSlug((await context.params).slug);
    return apiData(await listPublicSessions(slug, requestVisitorToken(request)), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const id = requestId(request);
  try {
    const slug = parsePublicSlug((await context.params).slug);
    return apiData(await createPublicSession(slug, requestVisitorToken(request), requestClientAddress(request.headers), id), id, { status: 201 });
  } catch (error) {
    return apiFailure(error, id);
  }
}
