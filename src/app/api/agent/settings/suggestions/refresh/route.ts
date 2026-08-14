import type { NextRequest } from "next/server";

import { refreshConversationSuggestions } from "@/server/agent/conversation-suggestions";
import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";
import { getRequestLocale } from "@/i18n/server";

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const suggestedQuestions = await refreshConversationSuggestions({ ownerId: user.id, mode: "preview", locale: await getRequestLocale() });
    return apiData({ suggestedQuestions }, id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
