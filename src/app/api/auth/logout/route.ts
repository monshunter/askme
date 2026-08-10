import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { revokeSession, SESSION_COOKIE } from "@/server/auth/service";
import { requestId, requestOrigin } from "@/server/http";

export async function POST(request: NextRequest) {
  await revokeSession(request.cookies.get(SESSION_COOKIE)?.value, requestId(request));
  const response = NextResponse.redirect(new URL("/login", requestOrigin(request)), 303);
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", expires: new Date(0) });
  return response;
}
