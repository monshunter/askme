import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";
import { loadHighlightCuration, parseHighlightSelection, saveFeaturedHighlights } from "@/server/publication/highlight-curation";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
    return apiData(await loadHighlightCuration(user.id, page), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}

export async function PUT(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "Send a valid JSON highlights selection.", 400);
    }
    return apiData(await saveFeaturedHighlights(user.id, parseHighlightSelection(body), id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
