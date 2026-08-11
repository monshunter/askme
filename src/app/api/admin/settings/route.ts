import type { NextRequest } from "next/server";

import { parseSettingsInput } from "@/server/admin/admin-input";
import { loadAdminSettings, updatePlatformSettings } from "@/server/admin/settings-service";
import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    await requireRequestUser(request, ["admin"]);
    return apiData(await loadAdminSettings(), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}

export async function PATCH(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["admin"]);
    if (Number(request.headers.get("content-length") ?? 0) > 4_096) throw new AppError("ADMIN_REQUEST_TOO_LARGE", "The settings request is too large.", 413);
    let body: unknown;
    try { body = await request.json(); } catch { throw new AppError("INVALID_JSON", "Send a valid JSON settings request.", 400); }
    return apiData(await updatePlatformSettings(user.id, parseSettingsInput(body), id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
