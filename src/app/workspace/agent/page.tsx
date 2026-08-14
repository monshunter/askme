import { headers } from "next/headers";

import { AgentPreviewClient } from "@/components/candidate/agent-preview-client";
import { getRequestLocale } from "@/i18n/server";
import { loadAgentSettings } from "@/server/agent/settings-service";
import { loadPreviewThread } from "@/server/agent/preview-service";
import { requirePageUser } from "@/server/auth/current";
import { loadPublicationOverview } from "@/server/publication/publication-service";

function pageOrigin(values: Headers) {
  const forwardedHost = values.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || values.get("host") || "127.0.0.1:3000";
  const protocol = values.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

export default async function AgentPreviewPage() {
  const user = await requirePageUser("candidate");
  const locale = await getRequestLocale();
  const [thread, settings, publicationOverview, requestHeaders] = await Promise.all([
    loadPreviewThread(user.id, undefined, locale),
    loadAgentSettings(user.id),
    loadPublicationOverview(user.id),
    headers(),
  ]);
  const shareUrl = publicationOverview.publication ? new URL(`/a/${publicationOverview.publication.slug}`, pageOrigin(requestHeaders)).toString() : null;
  return (
    <AgentPreviewClient
      initialThread={JSON.parse(JSON.stringify(thread))}
      initialSettings={JSON.parse(JSON.stringify(settings))}
      initialPublicationOverview={JSON.parse(JSON.stringify({ ...publicationOverview, shareUrl }))}
      locale={locale}
    />
  );
}
