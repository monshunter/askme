import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId, requestOrigin } from "@/server/http";
import { generatePublicationLink } from "@/server/publication/publication-service";

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const result = await generatePublicationLink(user.id, id);
    return apiData({ ...result, shareUrl: new URL(`/a/${result.publication.slug}`, requestOrigin(request)).toString() }, id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
