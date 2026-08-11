import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { toAppError } from "@/server/errors";

export function requestId(request: Request) {
  return request.headers.get("x-request-id")?.slice(0, 100) || randomUUID();
}

export function requestOrigin(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  if (!host) return new URL(request.url).origin;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const protocol = forwardedProto === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

export function apiData<T>(data: T, id: string, init?: ResponseInit) {
  return NextResponse.json({ data, error: null, requestId: id }, init);
}

export function apiFailure(error: unknown, id: string) {
  const appError = toAppError(error);
  if (appError.status >= 500) {
    console.error(
      JSON.stringify({
        event: "api.request.failed",
        requestId: id,
        code: appError.code,
        status: appError.status,
        causeType: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }
  const response = NextResponse.json(
    {
      data: null,
      error: { code: appError.code, message: appError.message, details: appError.details ?? null },
      requestId: id,
    },
    { status: appError.status },
  );
  const retryAfterSeconds = appError.details?.retryAfterSeconds;
  if (appError.status === 429 && typeof retryAfterSeconds === "number") response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}
