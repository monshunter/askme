import type { NextRequest } from "next/server";

import { parseCandidateStatusInput, requireAdminResourceId } from "@/server/admin/admin-input";
import { changeCandidateStatus } from "@/server/admin/candidate-service";
import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";

export async function PATCH(request: NextRequest, context: { params: Promise<{ candidateId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["admin"]);
    if (Number(request.headers.get("content-length") ?? 0) > 4_096) throw new AppError("ADMIN_REQUEST_TOO_LARGE", "The governance request is too large.", 413);
    let body: unknown;
    try { body = await request.json(); } catch { throw new AppError("INVALID_JSON", "Send a valid JSON governance request.", 400); }
    const candidateId = requireAdminResourceId((await context.params).candidateId);
    return apiData(await changeCandidateStatus(user.id, candidateId, parseCandidateStatusInput(body), id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
