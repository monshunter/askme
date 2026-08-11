import { ReportsClient } from "@/components/admin/reports-client";
import { getRequestLocale } from "@/i18n/server";
import { parseAdminRange } from "@/server/admin/admin-input";
import { loadAdminReport } from "@/server/admin/overview-service";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) { const range = parseAdminRange((await searchParams).range); const [report, locale] = await Promise.all([loadAdminReport(range), getRequestLocale()]); return <ReportsClient initialReport={JSON.parse(JSON.stringify(report))} locale={locale} />; }
