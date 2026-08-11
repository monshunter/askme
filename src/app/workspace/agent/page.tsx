import { AgentPreviewClient } from "@/components/candidate/agent-preview-client";
import { loadAgentSettings } from "@/server/agent/settings-service";
import { loadPreviewThread } from "@/server/agent/preview-service";
import { requirePageUser } from "@/server/auth/current";

export default async function AgentPreviewPage() {
  const user = await requirePageUser("candidate");
  const [thread, settings] = await Promise.all([loadPreviewThread(user.id), loadAgentSettings(user.id)]);
  return <AgentPreviewClient initialThread={JSON.parse(JSON.stringify(thread))} initialSettings={JSON.parse(JSON.stringify(settings))} />;
}
