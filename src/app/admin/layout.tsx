import type { ReactNode } from "react";

import { AdminShell } from "@/components/admin/admin-shell";
import { requirePageUser } from "@/server/auth/current";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser("admin");
  return <AdminShell user={{ displayName: user.displayName, avatarUrl: user.avatarUrl }}>{children}</AdminShell>;
}
