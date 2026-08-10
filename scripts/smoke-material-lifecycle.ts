import { Client } from "pg";

import { hashPassword } from "../src/server/auth/crypto";

const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";
const databaseUrl = process.env.DATABASE_URL;
const primaryEmail = process.env.ASKME_CANDIDATE_EMAIL;
const primaryPassword = process.env.ASKME_CANDIDATE_PASSWORD;
const secondaryEmail = "askme-lifecycle-owner@local.invalid";
const secondaryPassword = "Lifecycle-owner-local-2026!";

if (!databaseUrl || !primaryEmail || !primaryPassword) throw new Error("DATABASE_URL and Candidate smoke credentials are required");

async function login(email: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (response.status !== 200 || !cookie) throw new Error(`Login failed with status ${response.status}`);
  return cookie;
}

async function upload(cookie: string, name: string) {
  const form = new FormData();
  form.append("files", new File([`# ${name}\nOwner-isolation lifecycle evidence.`], name, { type: "text/markdown" }));
  const response = await fetch(`${baseUrl}/api/materials/upload`, { method: "POST", headers: { cookie }, body: form });
  const payload = (await response.json()) as { data?: { items?: Array<{ ok: boolean; material?: { id: string } }> }; error?: { code?: string } };
  const id = payload.data?.items?.[0]?.material?.id;
  if (response.status !== 201 || !id) throw new Error(`Upload failed: ${payload.error?.code ?? response.status}`);
  return id;
}

async function lifecycleRequest(cookie: string, path: string, method = "GET") {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { cookie } });
  return { response, payload: (await response.json()) as Record<string, unknown> };
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
let secondaryUserId: string | null = null;
let primaryMaterialId: string | null = null;
let secondaryMaterialId: string | null = null;
let primaryCookie: string | null = null;
let secondaryCookie: string | null = null;
let seededKnowledgeItemId: string | null = null;

try {
  const passwordHash = await hashPassword(secondaryPassword);
  const secondary = await client.query<{ id: string }>(
    `INSERT INTO users(email,password_hash,role,display_name)
     VALUES ($1,$2,'candidate','Lifecycle Owner')
     ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash,status='active'
     RETURNING id`,
    [secondaryEmail, passwordHash],
  );
  secondaryUserId = secondary.rows[0]!.id;
  primaryCookie = await login(primaryEmail, primaryPassword);
  secondaryCookie = await login(secondaryEmail, secondaryPassword);

  const marker = `lifecycle-${Date.now()}.md`;
  primaryMaterialId = await upload(primaryCookie, marker);
  secondaryMaterialId = await upload(secondaryCookie, marker);

  const listed = await lifecycleRequest(primaryCookie, `/api/materials?search=${encodeURIComponent(marker)}&pageSize=10`);
  const listedData = listed.payload.data as { items?: Array<Record<string, unknown>>; total?: number } | undefined;
  if (!listed.response.ok || listedData?.total !== 1 || listedData.items?.[0]?.id !== primaryMaterialId || "storagePath" in (listedData.items?.[0] ?? {})) {
    throw new Error("Owner-filtered material list or safe response projection failed");
  }

  const crossDelete = await lifecycleRequest(primaryCookie, `/api/materials/${secondaryMaterialId}`, "DELETE");
  const crossRetry = await lifecycleRequest(primaryCookie, `/api/materials/${secondaryMaterialId}/retry`, "POST");
  if (crossDelete.response.status !== 404 || crossRetry.response.status !== 404) throw new Error("Cross-owner material access was not hidden");

  await client.query("UPDATE materials SET status='failed',error_code='SMOKE_FAILURE',error_message='Controlled lifecycle failure' WHERE id=$1", [primaryMaterialId]);
  await client.query("UPDATE ingestion_jobs SET status='failed',last_error_code='SMOKE_FAILURE',last_error_message='Controlled lifecycle failure' WHERE material_id=$1", [
    primaryMaterialId,
  ]);
  const retried = await lifecycleRequest(primaryCookie, `/api/materials/${primaryMaterialId}/retry`, "POST");
  const retryData = retried.payload.data as { status?: string } | undefined;
  if (!retried.response.ok || retryData?.status !== "queued") throw new Error("Failed material did not return to queued");
  const duplicateRetry = await lifecycleRequest(primaryCookie, `/api/materials/${primaryMaterialId}/retry`, "POST");
  if (duplicateRetry.response.status !== 409) throw new Error("A non-failed material was incorrectly retryable");

  await client.query("UPDATE materials SET status='failed',error_code='SMOKE_DELETE',error_message='Controlled delete fixture' WHERE id=$1", [primaryMaterialId]);
  await client.query("UPDATE ingestion_jobs SET status='failed',last_error_code='SMOKE_DELETE',last_error_message='Controlled delete fixture' WHERE material_id=$1", [primaryMaterialId]);
  const seededKnowledge = await client.query<{ id: string }>(
    `INSERT INTO knowledge_items(owner_id,type,title,summary,highlights,confidence)
     SELECT owner_id,'project','Lifecycle delete fixture','Must be removed with its only source','[]'::jsonb,1 FROM materials WHERE id=$1
     RETURNING id`,
    [primaryMaterialId],
  );
  seededKnowledgeItemId = seededKnowledge.rows[0]?.id ?? null;
  if (!seededKnowledgeItemId) throw new Error("Delete fixture knowledge item could not be created");
  await client.query(
    `INSERT INTO knowledge_sources(knowledge_item_id,material_id,owner_id)
     SELECT $1,id,owner_id FROM materials WHERE id=$2`,
    [seededKnowledgeItemId, primaryMaterialId],
  );

  const deleted = await lifecycleRequest(primaryCookie, `/api/materials/${primaryMaterialId}`, "DELETE");
  if (!deleted.response.ok) throw new Error("Primary owner could not delete its material");
  primaryMaterialId = null;
  const derivedRemaining = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM knowledge_items WHERE id=$1", [seededKnowledgeItemId]);
  if (derivedRemaining.rows[0]?.count !== 0) throw new Error("Knowledge derived only from the deleted material became orphaned");
  seededKnowledgeItemId = null;
  const remaining = await lifecycleRequest(primaryCookie, `/api/materials?search=${encodeURIComponent(marker)}`);
  if ((remaining.payload.data as { total?: number } | undefined)?.total !== 0) throw new Error("Deleted or cross-owner material remained visible");

  const secondaryDeleted = await lifecycleRequest(secondaryCookie, `/api/materials/${secondaryMaterialId}`, "DELETE");
  if (!secondaryDeleted.response.ok) throw new Error("Secondary owner could not delete its own material");
  secondaryMaterialId = null;

  const audit = await client.query<{ action: string; outcome: string }>(
    "SELECT action,outcome FROM audit_events WHERE actor_id=(SELECT id FROM users WHERE email=$1) AND action IN ('material.retry','material.delete') ORDER BY created_at DESC",
    [primaryEmail.toLowerCase()],
  );
  if (!audit.rows.some((row) => row.action === "material.retry" && row.outcome === "queued") || !audit.rows.some((row) => row.action === "material.delete" && row.outcome === "deleted")) {
    throw new Error("Material lifecycle audit records are incomplete");
  }

  console.log(JSON.stringify({ event: "smoke.material-lifecycle.completed", ownerIsolation: true, retry: "queued", delete: "clean", safeProjection: true }));
} finally {
  if (primaryMaterialId && primaryCookie) await lifecycleRequest(primaryCookie, `/api/materials/${primaryMaterialId}`, "DELETE").catch(() => undefined);
  if (secondaryMaterialId && secondaryCookie) await lifecycleRequest(secondaryCookie, `/api/materials/${secondaryMaterialId}`, "DELETE").catch(() => undefined);
  if (secondaryUserId) await client.query("DELETE FROM users WHERE id=$1", [secondaryUserId]);
  await client.end();
}
