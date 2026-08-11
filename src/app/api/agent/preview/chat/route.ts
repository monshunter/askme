import type { NextRequest } from "next/server";

import { parseChatInput } from "@/server/agent/agent-input";
import { chatPreview } from "@/server/agent/preview-service";
import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    if (Number(request.headers.get("content-length") ?? 0) > 8_192) throw new AppError("CHAT_REQUEST_TOO_LARGE", "The chat request is too large.", 413);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "Send a valid JSON chat request.", 400);
    }
    return apiData(await chatPreview(user.id, parseChatInput(body), id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
