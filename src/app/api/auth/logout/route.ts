import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { revokeSession, SESSION_COOKIE } from "@/server/auth/service";
import { requestId, requestOrigin, withRequestId } from "@/server/http";

export async function POST(request: NextRequest) {
  const id = requestId(request);
  await revokeSession(request.cookies.get(SESSION_COOKIE)?.value, id);
  const response = withRequestId(NextResponse.redirect(new URL("/login", requestOrigin(request)), 303), id);
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", expires: new Date(0) });
  return response;
}
