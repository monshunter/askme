import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";
import { loadPreviewThread, resetPreviewConversations } from "@/server/agent/preview-service";
import { getRequestLocale } from "@/i18n/server";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    return apiData(await loadPreviewThread(user.id, undefined, await getRequestLocale()), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}

export async function DELETE(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const reset = await resetPreviewConversations(user.id, id);
    return apiData({ ...(await loadPreviewThread(user.id, reset.conversationId, await getRequestLocale())), resetCount: reset.resetCount }, id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
