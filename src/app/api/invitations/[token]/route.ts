import type { NextRequest } from "next/server";

import { parseInvitationAcceptance, requireInvitationToken } from "@/server/admin/admin-input";
import { acceptAdminInvitation, loadInvitation } from "@/server/admin/invitation-service";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const id = requestId(request);
  try {
    return apiData(await loadInvitation(requireInvitationToken((await context.params).token)), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const id = requestId(request);
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 4_096) throw new AppError("INVITATION_REQUEST_TOO_LARGE", "The invitation request is too large.", 413);
    let body: unknown;
    try { body = await request.json(); } catch { throw new AppError("INVALID_JSON", "Send a valid JSON invitation acceptance.", 400); }
    const token = requireInvitationToken((await context.params).token);
    return apiData(await acceptAdminInvitation(token, parseInvitationAcceptance(body), id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
