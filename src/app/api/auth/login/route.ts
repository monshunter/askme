import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticate, createSession, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/service";
import { apiFailure, requestId, requestOrigin } from "@/server/http";

const credentialsSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(1024),
});

export async function POST(request: NextRequest) {
  const id = requestId(request);
  const isJson = request.headers.get("content-type")?.includes("application/json") ?? false;

  try {
    const body = isJson ? await request.json() : Object.fromEntries(await request.formData());
    const credentials = credentialsSchema.parse(body);
    const user = await authenticate(credentials.email, credentials.password);
    const session = await createSession(user, id);
    const destination = user.role === "admin" ? "/admin" : "/workspace";
    const response = isJson
      ? NextResponse.json({ data: { user, destination }, error: null, requestId: id })
      : NextResponse.redirect(new URL(destination, requestOrigin(request)), 303);
    response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    if (isJson) return apiFailure(error, id);
    return NextResponse.redirect(new URL("/login?error=The+email+or+password+is+incorrect.", requestOrigin(request)), 303);
  }
}
