import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";
import { parseKnowledgeUpdate } from "@/server/knowledge/knowledge-input";
import { getKnowledgeDetail, updateKnowledge } from "@/server/knowledge/knowledge-service";
import { requireResourceId } from "@/server/resource-id";

export async function GET(request: NextRequest, context: { params: Promise<{ knowledgeItemId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const knowledgeItemId = requireResourceId((await context.params).knowledgeItemId, "knowledge");
    return apiData(await getKnowledgeDetail(user.id, knowledgeItemId), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ knowledgeItemId: string }> }) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const knowledgeItemId = requireResourceId((await context.params).knowledgeItemId, "knowledge");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "Send a valid JSON knowledge update.", 400);
    }
    return apiData(await updateKnowledge(user.id, knowledgeItemId, parseKnowledgeUpdate(body), id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
