import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";
import { loadCandidatePublicPreview } from "@/server/publication/public-agent-service";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    return apiData(await loadCandidatePublicPreview(user.id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
