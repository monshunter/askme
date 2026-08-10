import { requirePageUser } from "@/server/auth/current";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const user = await requirePageUser("candidate");
  return (
    <main className="foundation-page">
      <p className="eyebrow">Candidate Workspace</p>
      <h1>Welcome, {user.displayName}</h1>
      <p>Your authenticated Askme workspace is ready for career materials.</p>
      <form action="/api/auth/logout" method="post"><button type="submit">Sign out</button></form>
    </main>
  );
}
