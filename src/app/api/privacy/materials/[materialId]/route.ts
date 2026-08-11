import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";
import { parseVisibilityUpdate } from "@/server/privacy/privacy-input";
import { updateMaterialVisibility } from "@/server/privacy/privacy-service";
import { requireResourceId } from "@/server/resource-id";

export async function PATCH(request: NextRequest, context: { params: Promise<{ materialId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    if (Number(request.headers.get("content-length") ?? 0) > 4_096) throw new AppError("PRIVACY_REQUEST_TOO_LARGE", "The privacy request is too large.", 413);
    const materialId = requireResourceId((await context.params).materialId, "material");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "Send a valid JSON privacy update.", 400);
    }
    const update = parseVisibilityUpdate(body);
    return apiData(await updateMaterialVisibility(user.id, materialId, update.visibility, id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
