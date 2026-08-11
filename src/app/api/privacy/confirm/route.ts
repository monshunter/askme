import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId } from "@/server/http";
import { confirmPrivacyPolicy } from "@/server/privacy/privacy-service";

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    return apiData(await confirmPrivacyPolicy(user.id, id), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
