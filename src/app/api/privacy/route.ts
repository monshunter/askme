import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";
import { parseMaterialListQuery } from "@/server/materials/material-query";
import { getPrivacyOverview } from "@/server/privacy/privacy-service";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    return apiData(await getPrivacyOverview(user.id, parseMaterialListQuery(request.nextUrl.searchParams)), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
