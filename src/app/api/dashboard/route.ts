import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { getCandidateDashboard } from "@/server/dashboard/dashboard-service";
import { apiData, apiFailure, requestId } from "@/server/http";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    return apiData(await getCandidateDashboard(user.id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
