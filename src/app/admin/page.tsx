import { AdminOverviewClient } from "@/components/admin/overview-client";
import { getRequestLocale } from "@/i18n/server";
import { parseAdminRange } from "@/server/admin/admin-input";
import { loadAdminOverview } from "@/server/admin/overview-service";
import { requirePageUser } from "@/server/auth/current";

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requirePageUser("admin");
  const range = parseAdminRange((await searchParams).range);
  const [overview, locale] = await Promise.all([loadAdminOverview(range), getRequestLocale()]);
  return <AdminOverviewClient initialOverview={JSON.parse(JSON.stringify(overview))} adminName={user.displayName} locale={locale} />;
}
