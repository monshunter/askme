import { AdminRepositoriesClient } from "@/components/admin/repositories-client";
import { getRequestLocale } from "@/i18n/server";
import { parseAdminListQuery } from "@/server/admin/admin-input";
import { listAdminRepositories } from "@/server/admin/repository-analysis-service";

export const dynamic = "force-dynamic";

export default async function AdminRepositoriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") parameters.set(key, value);
  const query = parseAdminListQuery(parameters);
  const [data, locale] = await Promise.all([listAdminRepositories(query), getRequestLocale()]);
  return <AdminRepositoriesClient initialPage={JSON.parse(JSON.stringify(data))} initialFilters={query} locale={locale} />;
}
