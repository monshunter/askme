import type { NextRequest } from "next/server";

import { parseCandidateListQuery } from "@/server/admin/admin-input";
import { listAdminCandidates } from "@/server/admin/candidate-service";
import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    await requireRequestUser(request, ["admin"]);
    return apiData(await listAdminCandidates(parseCandidateListQuery(request.nextUrl.searchParams)), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
