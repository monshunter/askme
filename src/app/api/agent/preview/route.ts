import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";
import { loadPreviewThread } from "@/server/agent/preview-service";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    return apiData(await loadPreviewThread(user.id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
