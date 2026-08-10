import { requirePageUser } from "@/server/auth/current";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requirePageUser("admin");
  return (
    <main className="foundation-page">
      <p className="eyebrow">Platform Admin</p>
      <h1>Welcome, {user.displayName}</h1>
      <p>Your authenticated administration workspace is ready.</p>
      <form action="/api/auth/logout" method="post"><button type="submit">Sign out</button></form>
    </main>
  );
}
