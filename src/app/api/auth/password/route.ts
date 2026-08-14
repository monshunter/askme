import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { parseChangePasswordInput } from "@/server/auth/auth-input";
import { consumeAuthRateLimit } from "@/server/auth/auth-rate-limit";
import { changeCandidatePassword } from "@/server/auth/candidate-service";
import { requireRequestUser } from "@/server/auth/current";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/service";
import { AppError } from "@/server/errors";
import { apiFailure, requestId, requestOrigin, withRequestId } from "@/server/http";

export async function POST(request: NextRequest) {
  const id = requestId(request);
  const isJson = request.headers.get("content-type")?.includes("application/json") ?? false;
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    let body: unknown;
    try { body = isJson ? await request.json() : Object.fromEntries(await request.formData()); }
    catch { throw new AppError("INVALID_JSON", "Send valid password change details.", 400); }
    const input = parseChangePasswordInput(body);
    await consumeAuthRateLimit(`change:${user.id}`, 10, 3_600);
    await changeCandidatePassword(user.id, input, id);
    const session = await createSession(user, id);
    const response = withRequestId(isJson
      ? NextResponse.json({ data: { changed: true }, error: null, requestId: id })
      : NextResponse.redirect(new URL("/workspace/account?changed=1", requestOrigin(request)), 303), id);
    response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    if (isJson) return apiFailure(error, id);
    const code = error instanceof AppError && error.code === "PASSWORD_REUSE" ? "reuse" : "current";
    return withRequestId(NextResponse.redirect(new URL(`/workspace/account?error=${code}`, requestOrigin(request)), 303), id);
  }
}
