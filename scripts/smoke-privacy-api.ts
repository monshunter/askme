import { randomUUID } from "node:crypto";

import { Client } from "pg";

import { hashPassword } from "../src/server/auth/crypto";

const databaseUrl = process.env.DATABASE_URL;
const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3001";
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const client = new Client({ connectionString: databaseUrl });
const ownerId = randomUUID();
const materialId = randomUUID();
const email = `${ownerId}@local.invalid`;
const password = "Privacy-smoke-local-2026!";

await client.connect();
try {
  await client.query(
    "INSERT INTO users(id,email,password_hash,role,display_name) VALUES ($1,$2,$3,'candidate','Privacy Smoke')",
    [ownerId, email, await hashPassword(password)],
  );
  await client.query(
    `INSERT INTO materials(id,owner_id,kind,title,storage_path,external_url,status,visibility)
     VALUES ($1,$2,'website','Privacy API fixture',$3,'https://example.com/privacy-fixture','indexed','private')`,
    [materialId, ownerId, `${ownerId}/${materialId}/source.txt`],
  );

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  if (!login.ok || !cookie) throw new Error(`Privacy smoke login failed with ${login.status}`);

  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { cookie, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
    const payload = (await response.json()) as { data?: Record<string, unknown>; error?: { code?: string } };
    if (!response.ok) throw new Error(`${path} failed with ${response.status}:${payload.error?.code ?? "unknown"}`);
    return payload.data ?? {};
  };

  const page = await fetch(`${baseUrl}/workspace/privacy`, { headers: { cookie } });
  const pageHtml = await page.text();
  if (!page.ok || !pageHtml.includes("Privacy Control") || !pageHtml.includes("Manage Source Visibility") || !pageHtml.includes("Privacy API fixture")) {
    throw new Error("Privacy workspace did not render the authenticated database fixture");
  }

  const initial = await request("/api/privacy?pageSize=20") as { confirmation?: { confirmed?: boolean; policyRevision?: number }; materials?: { total?: number } };
  if (initial.confirmation?.confirmed !== false || initial.confirmation.policyRevision !== 1 || initial.materials?.total !== 1) throw new Error("Initial privacy overview is invalid");
  const confirmed = await request("/api/privacy/confirm", { method: "POST" }) as { confirmed?: boolean; policyRevision?: number };
  if (!confirmed.confirmed || confirmed.policyRevision !== 1) throw new Error("Initial policy confirmation failed");

  const unchanged = await request(`/api/privacy/materials/${materialId}`, { method: "PATCH", body: JSON.stringify({ visibility: "private" }) }) as {
    changed?: boolean;
    confirmation?: { confirmed?: boolean; policyRevision?: number };
  };
  if (unchanged.changed !== false || unchanged.confirmation?.confirmed !== true || unchanged.confirmation.policyRevision !== 1) {
    throw new Error("Idempotent visibility update invalidated confirmation");
  }

  const changed = await request(`/api/privacy/materials/${materialId}`, { method: "PATCH", body: JSON.stringify({ visibility: "citation_allowed" }) }) as {
    changed?: boolean;
    confirmation?: { confirmed?: boolean; policyRevision?: number };
  };
  if (changed.changed !== true || changed.confirmation?.confirmed !== false || changed.confirmation.policyRevision !== 2) {
    throw new Error("Visibility change did not invalidate and increment the policy");
  }
  const overview = await request("/api/privacy?pageSize=20") as {
    confirmation?: { confirmed?: boolean; policyRevision?: number };
    counts?: { interviewerAccessible?: number; interviewerHidden?: number };
  };
  if (overview.confirmation?.confirmed !== false || overview.confirmation.policyRevision !== 2 || overview.counts?.interviewerAccessible !== 1 || overview.counts.interviewerHidden !== 0) {
    throw new Error("Updated privacy overview is inconsistent");
  }
  const reconfirmed = await request("/api/privacy/confirm", { method: "POST" }) as { confirmed?: boolean; policyRevision?: number };
  if (!reconfirmed.confirmed || reconfirmed.policyRevision !== 2) throw new Error("Updated policy could not be confirmed");

  console.log(JSON.stringify({ event: "smoke.privacy-api.completed", pageRendered: true, initialRevision: 1, changedRevision: 2, idempotent: true, confirmationInvalidated: true, interviewerAccessible: 1 }));
} finally {
  await client.query("DELETE FROM users WHERE id=$1", [ownerId]).catch(() => undefined);
  await client.end();
}
