import { SettingsClient } from "@/components/admin/settings-client";
import { loadAdminSettings } from "@/server/admin/settings-service";

export const dynamic = "force-dynamic";

export default async function SettingsPage() { const settings = await loadAdminSettings(); return <SettingsClient initialSettings={JSON.parse(JSON.stringify(settings))} />; }
