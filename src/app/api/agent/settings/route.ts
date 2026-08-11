import type { NextRequest } from "next/server";

import { parseAgentSettingsPatch } from "@/server/agent/agent-settings-input";
import { loadAgentSettings, updateAgentSettings } from "@/server/agent/settings-service";
import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    return apiData(await loadAgentSettings(user.id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}

export async function PATCH(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "Send valid JSON Agent settings.", 400);
    }
    return apiData(await updateAgentSettings(user.id, parseAgentSettingsPatch(body), id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
