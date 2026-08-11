import type { NextRequest } from "next/server";

import { parseInvitationInput } from "@/server/admin/admin-input";
import { createAdminInvitation } from "@/server/admin/invitation-service";
import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId, requestOrigin } from "@/server/http";

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["admin"]);
    if (Number(request.headers.get("content-length") ?? 0) > 4_096) throw new AppError("ADMIN_REQUEST_TOO_LARGE", "The invitation request is too large.", 413);
    let body: unknown;
    try { body = await request.json(); } catch { throw new AppError("INVALID_JSON", "Send a valid JSON invitation request.", 400); }
    return apiData(await createAdminInvitation(user.id, parseInvitationInput(body), requestOrigin(request), id), id, { status: 201 });
  } catch (error) {
    return apiFailure(error, id);
  }
}
