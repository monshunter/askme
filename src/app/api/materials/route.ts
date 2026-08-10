import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";
import { parseMaterialListQuery } from "@/server/materials/material-query";
import { listMaterials } from "@/server/materials/material-service";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const query = parseMaterialListQuery(request.nextUrl.searchParams);
    return apiData(await listMaterials(user.id, query), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
