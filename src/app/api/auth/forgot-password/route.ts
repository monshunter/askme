import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { parseForgotPasswordInput } from "@/server/auth/auth-input";
import { consumeAuthRateLimit } from "@/server/auth/auth-rate-limit";
import { requestCandidatePasswordReset } from "@/server/auth/candidate-service";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId, requestOrigin, withRequestId } from "@/server/http";
import { requestClientAddress } from "@/server/public-chat/visitor-credential";

export async function POST(request: NextRequest) {
  const id = requestId(request);
  const isJson = request.headers.get("content-type")?.includes("application/json") ?? false;
  try {
    let body: unknown;
    try { body = isJson ? await request.json() : Object.fromEntries(await request.formData()); }
    catch { throw new AppError("INVALID_JSON", "Send a valid email address.", 400); }
    const input = parseForgotPasswordInput(body);
    await Promise.all([
      consumeAuthRateLimit(`forgot:email:${input.email}`, 5, 3_600),
      consumeAuthRateLimit(`forgot:ip:${requestClientAddress(request.headers)}`, 20, 3_600),
    ]);
    const result = await requestCandidatePasswordReset(input, id);
    return isJson ? apiData(result, id) : withRequestId(NextResponse.redirect(new URL("/forgot-password?sent=1", requestOrigin(request)), 303), id);
  } catch (error) {
    if (isJson) return apiFailure(error, id);
    const code = error instanceof AppError && error.code === "MAIL_NOT_CONFIGURED" ? "mail" : "invalid";
    return withRequestId(NextResponse.redirect(new URL(`/forgot-password?error=${code}`, requestOrigin(request)), 303), id);
  }
}
