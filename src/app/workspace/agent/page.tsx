import { AgentPreviewClient } from "@/components/candidate/agent-preview-client";
import { getRequestLocale } from "@/i18n/server";
import { loadAgentSettings } from "@/server/agent/settings-service";
import { loadPreviewThread } from "@/server/agent/preview-service";
import { requirePageUser } from "@/server/auth/current";

export default async function AgentPreviewPage() {
  const user = await requirePageUser("candidate");
  const [thread, settings, locale] = await Promise.all([loadPreviewThread(user.id), loadAgentSettings(user.id), getRequestLocale()]);
  return <AgentPreviewClient initialThread={JSON.parse(JSON.stringify(thread))} initialSettings={JSON.parse(JSON.stringify(settings))} locale={locale} />;
}
