import { CandidateShell } from "@/components/candidate/candidate-shell";
import { requirePageUser } from "@/server/auth/current";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser("candidate");
  return <CandidateShell user={user}>{children}</CandidateShell>;
}
