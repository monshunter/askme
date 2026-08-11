import { CandidatesClient } from "@/components/admin/candidates-client";
import { getRequestLocale } from "@/i18n/server";
import { parseCandidateListQuery } from "@/server/admin/admin-input";
import { listAdminCandidates } from "@/server/admin/candidate-service";

export const dynamic = "force-dynamic";

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams; const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") parameters.set(key, value);
  const query = parseCandidateListQuery(parameters); const [data, locale] = await Promise.all([listAdminCandidates(query), getRequestLocale()]);
  return <CandidatesClient initialPage={JSON.parse(JSON.stringify(data))} initialFilters={query} locale={locale} />;
}
