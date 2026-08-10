import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";
import { parseKnowledgeListQuery } from "@/server/knowledge/knowledge-query";
import { listKnowledge } from "@/server/knowledge/knowledge-service";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    return apiData(await listKnowledge(user.id, parseKnowledgeListQuery(request.nextUrl.searchParams)), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
