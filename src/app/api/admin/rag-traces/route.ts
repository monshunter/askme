import type { NextRequest } from "next/server";

import { listAdminRagTraces } from "@/server/admin/rag-trace-service";
import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    await requireRequestUser(request, ["admin"]);
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    return apiData(await listAdminRagTraces(Number.isFinite(limit) ? limit : 50), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
