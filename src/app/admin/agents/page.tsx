import { AgentsClient } from "@/components/admin/agents-client";
import { parseAgentListQuery } from "@/server/admin/admin-input";
import { listAdminAgents } from "@/server/admin/publication-service";

export const dynamic = "force-dynamic";

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams; const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") parameters.set(key, value);
  const query = parseAgentListQuery(parameters); const data = await listAdminAgents(query);
  return <AgentsClient initialPage={JSON.parse(JSON.stringify(data))} initialFilters={query} />;
}
