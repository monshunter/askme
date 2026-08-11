import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";
import { parseAdminRange } from "@/server/admin/admin-input";
import { loadAdminOverview } from "@/server/admin/overview-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    await requireRequestUser(request, ["admin"]);
    const range = parseAdminRange(request.nextUrl.searchParams.get("range"));
    return apiData(await loadAdminOverview(range), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
