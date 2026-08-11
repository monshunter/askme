import type { ReactNode } from "react";

import { AdminShell } from "@/components/admin/admin-shell";
import { getRequestLocale } from "@/i18n/server";
import { requirePageUser } from "@/server/auth/current";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [user, locale] = await Promise.all([requirePageUser("admin"), getRequestLocale()]);
  return <AdminShell user={{ displayName: user.displayName, avatarUrl: user.avatarUrl }} locale={locale}>{children}</AdminShell>;
}
