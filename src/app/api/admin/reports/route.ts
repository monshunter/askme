import type { NextRequest } from "next/server";

import { parseAdminRange } from "@/server/admin/admin-input";
import { loadAdminReport } from "@/server/admin/overview-service";
import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    await requireRequestUser(request, ["admin"]);
    return apiData(await loadAdminReport(parseAdminRange(request.nextUrl.searchParams.get("range"))), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
