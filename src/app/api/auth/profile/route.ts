import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { parseCandidateProfileInput } from "@/server/auth/auth-input";
import { updateCandidateProfile } from "@/server/auth/candidate-service";
import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId, requestOrigin, withRequestId } from "@/server/http";

function safeReturnTarget(value: unknown) {
  return value === "/workspace/agent" ? value : null;
}

export async function POST(request: NextRequest) {
  const id = requestId(request);
  const isJson = request.headers.get("content-type")?.includes("application/json") ?? false;
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    let body: Record<string, unknown>;
    try {
      body = isJson ? await request.json() as Record<string, unknown> : Object.fromEntries(await request.formData());
    } catch {
      throw new AppError("INVALID_JSON", "Send valid public profile details.", 400);
    }
    const returnTo = safeReturnTarget(body.returnTo);
    const input = parseCandidateProfileInput(body);
    const result = await updateCandidateProfile(user.id, input, id);
    if (isJson) return apiData(result, id);
    const destination = returnTo ?? "/workspace/account?profile=changed#public-profile";
    return withRequestId(NextResponse.redirect(new URL(destination, requestOrigin(request)), 303), id);
  } catch (error) {
    if (isJson) return apiFailure(error, id);
    return withRequestId(NextResponse.redirect(new URL("/workspace/account?profileError=invalid#public-profile", requestOrigin(request)), 303), id);
  }
}
