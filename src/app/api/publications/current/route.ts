import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { apiData, apiFailure, requestId, requestOrigin } from "@/server/http";
import { loadPublicationOverview } from "@/server/publication/publication-service";

function withShareUrl<T extends { publication: { slug: string } | null }>(value: T, origin: string) {
  return { ...value, shareUrl: value.publication ? new URL(`/a/${value.publication.slug}`, origin).toString() : null };
}

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    return apiData(withShareUrl(await loadPublicationOverview(user.id), requestOrigin(request)), id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
