import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticate, createSession, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/service";
import { consumeAuthRateLimit } from "@/server/auth/auth-rate-limit";
import { AppError } from "@/server/errors";
import { apiFailure, requestId, requestOrigin, withRequestId } from "@/server/http";
import { requestClientAddress } from "@/server/public-chat/visitor-credential";

const credentialsSchema = z.object({
  email: z.string().trim().pipe(z.email().max(320)).transform((value) => value.toLocaleLowerCase()),
  password: z.string().min(1).max(1024),
});

export async function POST(request: NextRequest) {
  const id = requestId(request);
  const isJson = request.headers.get("content-type")?.includes("application/json") ?? false;

  try {
    let body: unknown;
    if (isJson) {
      try { body = await request.json(); } catch { throw new AppError("INVALID_JSON", "Send valid JSON credentials.", 400); }
    } else {
      body = Object.fromEntries(await request.formData());
    }
    const parsed = credentialsSchema.safeParse(body);
    if (!parsed.success) throw new AppError("INVALID_CREDENTIALS_INPUT", "Enter a valid email and password.", 400);
    const credentials = parsed.data;
    await Promise.all([
      consumeAuthRateLimit(`login:email:${credentials.email}`, 10, 15 * 60),
      consumeAuthRateLimit(`login:ip:${requestClientAddress(request.headers)}`, 30, 15 * 60),
    ]);
    const user = await authenticate(credentials.email, credentials.password);
    const session = await createSession(user, id);
    const destination = user.role === "admin" ? "/admin" : "/workspace";
    const response = withRequestId(isJson
      ? NextResponse.json({ data: { user, destination }, error: null, requestId: id })
      : NextResponse.redirect(new URL(destination, requestOrigin(request)), 303), id);
    response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    if (isJson) return apiFailure(error, id);
    return withRequestId(NextResponse.redirect(new URL("/login?error=The+email+or+password+is+incorrect.", requestOrigin(request)), 303), id);
  }
}
