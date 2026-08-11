import type { NextRequest } from "next/server";

import { parseFeedbackInput } from "@/server/agent/agent-input";
import { saveCandidateFeedback } from "@/server/agent/preview-service";
import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";
import { requireResourceId } from "@/server/resource-id";

export async function PUT(request: NextRequest, context: { params: Promise<{ messageId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const messageId = requireResourceId((await context.params).messageId, "message");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "Send valid JSON feedback.", 400);
    }
    return apiData(await saveCandidateFeedback(user.id, messageId, parseFeedbackInput(body), id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
