import { randomUUID } from "node:crypto";

import { Client } from "pg";

import { getRuntimeConfig } from "../src/server/config";

const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";
const mailpitUrl = process.env.ASKME_MAILPIT_URL ?? "http://127.0.0.1:8025";
const databaseUrl = process.env.DATABASE_URL
  ?? `postgresql://${encodeURIComponent(process.env.ASKME_POSTGRES_USER ?? "askme")}:${encodeURIComponent(process.env.ASKME_POSTGRES_PASSWORD ?? "askme-local-only")}@127.0.0.1:${process.env.ASKME_POSTGRES_PORT ?? "55432"}/${encodeURIComponent(process.env.ASKME_POSTGRES_DB ?? "askme")}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function responseCookie(response: Response) {
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? null;
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
  const cookie = responseCookie(response);
  assert(response.status === 303 && cookie, `Login failed with ${response.status}`);
  return { cookie, destination: response.headers.get("location") };
}

async function postJson(path: string, body: Record<string, string>, cookie?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  const payload = await response.json() as {
    data?: Record<string, unknown> | null;
    error?: { code?: string; message?: string } | null;
  };
  return { response, payload, cookie: responseCookie(response) };
}

async function currentUser(cookie: string) {
  const response = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
  const payload = (await response.json()) as { data?: { user?: { email: string; role: string; displayName: string; headline: string | null; location: string | null; bio: string | null } }; error?: { code?: string } };
  return { response, payload };
}

async function waitForResetToken(email: string, publicBaseUrl: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${mailpitUrl}/api/v1/message/latest`);
    if (response.ok) {
      const message = await response.json() as { To?: Array<{ Address?: string }>; Text?: string };
      const addressedToCandidate = message.To?.some((address) => address.Address?.toLowerCase() === email) ?? false;
      const token = addressedToCandidate ? /\/reset-password\/([A-Za-z0-9_-]{43})/.exec(message.Text ?? "")?.[1] : undefined;
      if (token) {
        assert(message.Text?.includes(`${publicBaseUrl}reset-password/${token}`), "Password reset email did not use ASKME_PUBLIC_BASE_URL");
        return token;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Password reset email was not observed in Mailpit");
}

async function waitForAdminInvitation(email: string, publicBaseUrl: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${mailpitUrl}/api/v1/message/latest`);
    if (response.ok) {
      const message = await response.json() as { To?: Array<{ Address?: string }>; Subject?: string; Text?: string };
      const addressedToAdmin = message.To?.some((address) => address.Address?.toLowerCase() === email) ?? false;
      const token = addressedToAdmin && message.Subject === "You are invited to administer Askme"
        ? /\/invite\/([A-Za-z0-9_-]{43})/.exec(message.Text ?? "")?.[1]
        : undefined;
      if (token) {
        assert(message.Text?.includes(`${publicBaseUrl}invite/${token}`), "Admin invitation email did not use ASKME_PUBLIC_BASE_URL");
        return token;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Admin invitation email was not observed in Mailpit");
}

async function verifyCandidateLifecycle(publicBaseUrl: string) {
  const suffix = randomUUID().slice(0, 8);
  const email = `auth-smoke-${suffix}@askme.local`;
  const initialPassword = `Candidate-initial-${suffix}!`;
  const resetPassword = `Candidate-reset-${suffix}!`;
  const finalPassword = `Candidate-final-${suffix}!`;
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const registration = await postJson("/api/auth/register", {
      email,
      displayName: "Auth Smoke Candidate",
      password: initialPassword,
      confirmPassword: initialPassword,
      role: "admin",
    });
    assert(registration.response.status === 201 && registration.cookie, `Candidate registration failed with ${registration.response.status}`);
    const registeredMe = await currentUser(registration.cookie);
    assert(registeredMe.response.ok && registeredMe.payload.data?.user?.email === email, "Registration session was not resolved");
    assert(registeredMe.payload.data?.user?.role === "candidate", "Public registration escaped the Candidate role boundary");
    const profile = await postJson("/api/auth/profile", {
      displayName: "Auth Smoke Candidate",
      headline: "Career Agent Test Engineer",
      location: "Smoke Lab",
      bio: "Validates Candidate identity and publication readiness.",
      ownerId: "another-user",
      role: "admin",
    }, registration.cookie);
    assert(profile.response.status === 200 && profile.payload.data?.updated === true, `Candidate profile update failed with ${profile.response.status}`);
    const profiledMe = await currentUser(registration.cookie);
    assert(profiledMe.payload.data?.user?.headline === "Career Agent Test Engineer", "Candidate profile update was not persisted for the current account");
    assert(profiledMe.payload.data?.user?.role === "candidate", "Candidate profile update changed the account role");

    const unknownReset = await postJson("/api/auth/forgot-password", { email: `unknown-${suffix}@askme.local` });
    const knownReset = await postJson("/api/auth/forgot-password", { email });
    assert(unknownReset.response.status === 200 && knownReset.response.status === 200, "Forgot-password requests were not accepted uniformly");
    assert(unknownReset.payload.data?.accepted === true && knownReset.payload.data?.accepted === true, "Forgot-password responses leaked account existence");

    const resetToken = await waitForResetToken(email, publicBaseUrl);
    const reset = await postJson("/api/auth/reset-password", {
      token: resetToken,
      password: resetPassword,
      confirmPassword: resetPassword,
    });
    assert(reset.response.status === 200 && reset.payload.data?.reset === true, `Password reset failed with ${reset.response.status}`);
    const revokedRegistrationSession = await currentUser(registration.cookie);
    assert(revokedRegistrationSession.response.status === 401, "Password reset left the registration session active");

    const replay = await postJson("/api/auth/reset-password", {
      token: resetToken,
      password: finalPassword,
      confirmPassword: finalPassword,
    });
    assert(replay.response.status === 410 && replay.payload.error?.code === "PASSWORD_RESET_INVALID", "One-time password reset token was reusable");

    const resetLogin = await login(email, resetPassword);
    const change = await postJson("/api/auth/password", {
      currentPassword: resetPassword,
      newPassword: finalPassword,
      confirmPassword: finalPassword,
    }, resetLogin.cookie);
    assert(change.response.status === 200 && change.cookie, `Authenticated password change failed with ${change.response.status}`);
    const revokedResetSession = await currentUser(resetLogin.cookie);
    assert(revokedResetSession.response.status === 401, "Password change left the old session active");
    const replacementSession = await currentUser(change.cookie);
    assert(replacementSession.response.ok && replacementSession.payload.data?.user?.email === email, "Replacement password-change session was not active");
    const finalLogin = await login(email, finalPassword);
    assert((await currentUser(finalLogin.cookie)).response.ok, "Changed password could not authenticate");

    return {
      registration: registration.response.status,
      profile: profile.response.status,
      forgotPassword: knownReset.response.status,
      resetPassword: reset.response.status,
      tokenReplay: replay.response.status,
      resetRevokedSessions: revokedRegistrationSession.response.status,
      changePassword: change.response.status,
      changeRevokedSessions: revokedResetSession.response.status,
    };
  } finally {
    await db.query("DELETE FROM users WHERE email=$1", [email]).catch(() => undefined);
    await db.end();
  }
}

async function verifyAdminInvitationMail(adminCookie: string, publicBaseUrl: string) {
  const suffix = randomUUID().slice(0, 8);
  const email = `admin-mail-smoke-${suffix}@askme.local`;
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  let invitationId: string | null = null;
  try {
    const invitation = await postJson("/api/admin/invitations", { email, displayName: "SMTP Smoke Admin" }, adminCookie);
    invitationId = typeof invitation.payload.data?.id === "string" ? invitation.payload.data.id : null;
    assert(invitation.response.status === 201 && invitation.payload.data?.status === "sent" && invitationId, `Admin invitation SMTP delivery failed with ${invitation.response.status}`);
    const token = await waitForAdminInvitation(email, publicBaseUrl);
    const persisted = await db.query<{ tokenHash: string; status: string }>(
      "SELECT token_hash AS \"tokenHash\",status FROM admin_invitations WHERE id=$1",
      [invitationId],
    );
    assert(persisted.rows[0]?.status === "sent" && persisted.rows[0].tokenHash !== token, "Admin invitation did not persist only a sent token hash");
    return { status: invitation.response.status, mailpitObserved: true, publicBaseUrl };
  } finally {
    if (invitationId) {
      await db.query("DELETE FROM audit_events WHERE target_type='admin_invitation' AND target_id=$1", [invitationId]).catch(() => undefined);
      await db.query("DELETE FROM admin_invitations WHERE id=$1", [invitationId]).catch(() => undefined);
    }
    await db.end();
  }
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

  const candidateLifecycle = await verifyCandidateLifecycle(config.publicBaseUrl);
  const adminInvitationMail = await verifyAdminInvitationMail(admin.cookie, config.publicBaseUrl);
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
      candidateLifecycle,
      adminInvitationMail,
    }),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown auth smoke failure";
  console.error(JSON.stringify({ event: "smoke.auth.failed", message }));
  process.exitCode = 1;
});
