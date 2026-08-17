import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { apiFailure, requestId, withRequestId } from "@/server/http";
import { materialContentResponse } from "@/server/materials/material-content-response";
import { getCandidateMaterialContent } from "@/server/materials/material-content-service";
import { requireResourceId } from "@/server/resource-id";

export async function GET(request: NextRequest, context: { params: Promise<{ materialId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const materialId = requireResourceId((await context.params).materialId, "material");
    return withRequestId(materialContentResponse(await getCandidateMaterialContent(user.id, materialId)), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
