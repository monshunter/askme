import { SettingsClient } from "@/components/admin/settings-client";
import { getRequestLocale } from "@/i18n/server";
import { loadAdminSettings } from "@/server/admin/settings-service";

export const dynamic = "force-dynamic";

export default async function SettingsPage() { const [settings, locale] = await Promise.all([loadAdminSettings(), getRequestLocale()]); return <SettingsClient initialSettings={JSON.parse(JSON.stringify(settings))} locale={locale} />; }
