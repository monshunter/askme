import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";
import { deleteMaterial } from "@/server/materials/material-service";
import { requireResourceId } from "@/server/resource-id";

export async function DELETE(request: NextRequest, context: { params: Promise<{ materialId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const materialId = requireResourceId((await context.params).materialId, "material");
    return apiData(await deleteMaterial(user.id, materialId, id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
