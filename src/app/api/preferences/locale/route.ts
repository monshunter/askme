import type { NextRequest } from "next/server";

import { isLocale, LOCALE_COOKIE, localeCookieOptions } from "@/i18n/core";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId, requestOrigin } from "@/server/http";

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  const id = requestId(request);
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 1_024) {
      throw new AppError("LOCALE_REQUEST_TOO_LARGE", "The locale request is too large.", 413);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "Send a valid JSON locale request.", 400);
    }

    const locale = typeof body === "object" && body !== null && "locale" in body ? body.locale : undefined;
    if (!isLocale(locale)) throw new AppError("INVALID_LOCALE", "Choose a supported locale.", 400);

    const response = apiData({ locale }, id);
    response.cookies.set(LOCALE_COOKIE, locale, localeCookieOptions(new URL(requestOrigin(request)).protocol === "https:"));
    return response;
  } catch (error) {
    return apiFailure(error, id);
  }
}
