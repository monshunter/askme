import type { NextRequest } from "next/server";

import { parseAgentListQuery } from "@/server/admin/admin-input";
import { listAdminAgents } from "@/server/admin/publication-service";
import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    await requireRequestUser(request, ["admin"]);
    return apiData(await listAdminAgents(parseAgentListQuery(request.nextUrl.searchParams)), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
