import { headers } from "next/headers";

import { PublishClient } from "@/components/candidate/publish-client";
import { requirePageUser } from "@/server/auth/current";
import { loadPublicationOverview } from "@/server/publication/publication-service";

function pageOrigin(values: Headers) {
  const forwardedHost = values.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || values.get("host") || "127.0.0.1:3000";
  const protocol = values.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

export default async function PublishPage() {
  const user = await requirePageUser("candidate");
  const [overview, requestHeaders] = await Promise.all([loadPublicationOverview(user.id), headers()]);
  const shareUrl = overview.publication ? new URL(`/a/${overview.publication.slug}`, pageOrigin(requestHeaders)).toString() : null;
  return <PublishClient initialOverview={JSON.parse(JSON.stringify({ ...overview, shareUrl }))} />;
}
