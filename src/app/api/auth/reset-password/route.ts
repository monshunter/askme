import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { parseResetPasswordInput } from "@/server/auth/auth-input";
import { consumeAuthRateLimit } from "@/server/auth/auth-rate-limit";
import { resetCandidatePassword } from "@/server/auth/candidate-service";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId, requestOrigin, withRequestId } from "@/server/http";

export async function POST(request: NextRequest) {
  const id = requestId(request);
  const isJson = request.headers.get("content-type")?.includes("application/json") ?? false;
  let token = "";
  try {
    let body: unknown;
    try { body = isJson ? await request.json() : Object.fromEntries(await request.formData()); }
    catch { throw new AppError("INVALID_JSON", "Send valid password reset details.", 400); }
    const input = parseResetPasswordInput(body);
    token = input.token;
    await consumeAuthRateLimit(`reset:${input.token}`, 10, 3_600);
    const result = await resetCandidatePassword(input, id);
    return isJson ? apiData(result, id) : withRequestId(NextResponse.redirect(new URL("/login?reset=1", requestOrigin(request)), 303), id);
  } catch (error) {
    if (isJson) return apiFailure(error, id);
    const destination = /^[A-Za-z0-9_-]{43}$/.test(token) ? `/reset-password/${token}?error=invalid` : "/forgot-password?error=invalid";
    return withRequestId(NextResponse.redirect(new URL(destination, requestOrigin(request)), 303), id);
  }
}
