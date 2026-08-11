import type { NextRequest } from "next/server";

import { parseContentReviewInput, requireAdminResourceId } from "@/server/admin/admin-input";
import { decideContentReview } from "@/server/admin/review-service";
import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";

export async function PATCH(request: NextRequest, context: { params: Promise<{ flagId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["admin"]);
    if (Number(request.headers.get("content-length") ?? 0) > 4_096) throw new AppError("ADMIN_REQUEST_TOO_LARGE", "The review request is too large.", 413);
    let body: unknown;
    try { body = await request.json(); } catch { throw new AppError("INVALID_JSON", "Send a valid JSON review request.", 400); }
    const flagId = requireAdminResourceId((await context.params).flagId);
    return apiData(await decideContentReview(user.id, flagId, parseContentReviewInput(body), id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
