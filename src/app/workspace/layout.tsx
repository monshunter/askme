import { CandidateShell } from "@/components/candidate/candidate-shell";
import { getRequestLocale } from "@/i18n/server";
import { requirePageUser } from "@/server/auth/current";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const [user, locale] = await Promise.all([requirePageUser("candidate"), getRequestLocale()]);
  return <CandidateShell user={user} locale={locale}>{children}</CandidateShell>;
}
