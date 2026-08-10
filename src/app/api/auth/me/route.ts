import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    return apiData({ user: await requireRequestUser(request, ["candidate", "admin"]) }, id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
