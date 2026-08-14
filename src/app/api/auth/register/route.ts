import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { parseRegistrationInput } from "@/server/auth/auth-input";
import { consumeAuthRateLimit } from "@/server/auth/auth-rate-limit";
import { registerCandidate } from "@/server/auth/candidate-service";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/service";
import { AppError } from "@/server/errors";
import { apiFailure, requestId, requestOrigin, withRequestId } from "@/server/http";
import { requestClientAddress } from "@/server/public-chat/visitor-credential";

export async function POST(request: NextRequest) {
  const id = requestId(request);
  const isJson = request.headers.get("content-type")?.includes("application/json") ?? false;
  try {
    let body: unknown;
    try { body = isJson ? await request.json() : Object.fromEntries(await request.formData()); }
    catch { throw new AppError("INVALID_JSON", "Send valid registration details.", 400); }
    const input = parseRegistrationInput(body);
    await Promise.all([
      consumeAuthRateLimit(`register:email:${input.email}`, 3, 3_600),
      consumeAuthRateLimit(`register:ip:${requestClientAddress(request.headers)}`, 10, 3_600),
    ]);
    const user = await registerCandidate(input, id);
    const session = await createSession(user, id);
    const response = withRequestId(isJson
      ? NextResponse.json({ data: { user, destination: "/workspace" }, error: null, requestId: id }, { status: 201 })
      : NextResponse.redirect(new URL("/workspace", requestOrigin(request)), 303), id);
    response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    if (isJson) return apiFailure(error, id);
    const code = error instanceof AppError && error.code === "ACCOUNT_EXISTS" ? "exists" : "invalid";
    return withRequestId(NextResponse.redirect(new URL(`/register?error=${code}`, requestOrigin(request)), 303), id);
  }
}
