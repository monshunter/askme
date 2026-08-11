import type { NextRequest } from "next/server";

import { apiData, apiFailure, requestId } from "@/server/http";
import { loadPublicAgentBySlug } from "@/server/publication/public-agent-service";

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const id = requestId(request);
  try {
    return apiData(await loadPublicAgentBySlug((await context.params).slug), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
