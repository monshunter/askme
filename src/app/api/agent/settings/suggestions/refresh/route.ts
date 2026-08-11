import type { NextRequest } from "next/server";

import { refreshSuggestedQuestions } from "@/server/agent/settings-service";
import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    return apiData(await refreshSuggestedQuestions(user.id, id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
