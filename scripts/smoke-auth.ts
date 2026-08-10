import { getRuntimeConfig } from "../src/server/config";

const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function login(email: string | null, password: string | null) {
  assert(email && password, "Smoke credentials are not configured");
  const body = new URLSearchParams({ email, password });
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(response.status === 303 && cookie, `Login failed with ${response.status}`);
  return { cookie, destination: response.headers.get("location") };
}

async function currentUser(cookie: string) {
  const response = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
  const payload = (await response.json()) as { data?: { user?: { email: string; role: string } }; error?: { code?: string } };
  return { response, payload };
}

async function main() {
  const config = getRuntimeConfig();
  const live = await fetch(`${baseUrl}/api/health/live`);
  const ready = await fetch(`${baseUrl}/api/health/ready`);
  assert(live.ok, `Live check failed with ${live.status}`);
  assert(ready.ok, `Ready check failed with ${ready.status}`);

  const candidate = await login(config.bootstrap.candidateEmail, config.bootstrap.candidatePassword);
  assert(candidate.destination === `${baseUrl}/workspace`, "Candidate login redirect did not preserve the public origin");
  const candidateMe = await currentUser(candidate.cookie);
  assert(candidateMe.response.ok && candidateMe.payload.data?.user?.role === "candidate", "Candidate session was not resolved");
  const wrongWorkspace = await fetch(`${baseUrl}/admin`, { headers: { cookie: candidate.cookie }, redirect: "manual" });
  assert(wrongWorkspace.status === 307 && wrongWorkspace.headers.get("location")?.endsWith("/workspace"), "Candidate role guard failed");

  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie: candidate.cookie }, redirect: "manual" });
  assert(logout.status === 303, "Logout did not redirect");
  const afterLogout = await currentUser(candidate.cookie);
  assert(afterLogout.response.status === 401 && afterLogout.payload.error?.code === "UNAUTHENTICATED", "Revoked session remained active");

  const admin = await login(config.bootstrap.adminEmail, config.bootstrap.adminPassword);
  assert(admin.destination === `${baseUrl}/admin`, "Admin login redirect did not preserve the public origin");
  const adminMe = await currentUser(admin.cookie);
  assert(adminMe.response.ok && adminMe.payload.data?.user?.role === "admin", "Admin session was not resolved");

  console.info(
    JSON.stringify({
      event: "smoke.auth.completed",
      live: live.status,
      ready: ready.status,
      candidate: { role: candidateMe.payload.data?.user?.role, destination: candidate.destination },
      candidateAdminGuard: wrongWorkspace.status,
      logout: logout.status,
      revokedSession: afterLogout.response.status,
      admin: { role: adminMe.payload.data?.user?.role, destination: admin.destination },
    }),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown auth smoke failure";
  console.error(JSON.stringify({ event: "smoke.auth.failed", message }));
  process.exitCode = 1;
});
