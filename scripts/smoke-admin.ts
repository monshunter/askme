import { randomBytes, randomUUID } from "node:crypto";

import { Client } from "pg";

import { hashPassword } from "../src/server/auth/crypto";
import { getRuntimeConfig } from "../src/server/config";

const databaseUrl = process.env.DATABASE_URL;
const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";
if (!databaseUrl) throw new Error("DATABASE_URL is required");

type Envelope<T = unknown> = { data: T | null; error: { code?: string; message?: string } | null; requestId?: string };
type PolicyRow = { key: string; value: unknown; updatedBy: string | null; updatedAt: Date };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const db = new Client({ connectionString: databaseUrl });
const runId = `admin-smoke-${randomUUID()}`;
const candidateId = randomUUID();
const publicMaterialId = randomUUID();
const privateMaterialId = randomUUID();
const publicChunkId = randomUUID();
const privateChunkId = randomUUID();
const publicKnowledgeId = randomUUID();
const privateKnowledgeId = randomUUID();
const publicationId = randomUUID();
const conversationId = randomUUID();
const messageId = randomUUID();
const resolveFlagId = randomUUID();
const dismissFlagId = randomUUID();
const slug = randomBytes(24).toString("base64url");
const password = "Admin-smoke-local-2026!";
const candidateEmail = `${candidateId}@local.invalid`;
const candidateDisplayName = `Governance ${candidateId.slice(0, 8)}`;
const privateMarker = `PRIVATE_ADMIN_FORBIDDEN_${randomUUID()}`;
const safeSummary = `Governance review ${candidateId.slice(0, 8)}`;
const policyKeys = ["public_session_hourly_limit", "public_chat_minute_limit", "negative_feedback_auto_flag"];
let requestNumber = 0;
let originalPolicies: PolicyRow[] = [];

async function login(email: string | null, loginPassword: string | null) {
  assert(email && loginPassword, "Smoke credentials are not configured");
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password: loginPassword }),
    redirect: "manual",
  });
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(response.status === 303 && cookie, `Login failed for ${email} with ${response.status}`);
  return cookie;
}

async function api<T>(path: string, options: { cookie?: string; method?: string; body?: unknown } = {}) {
  const requestId = `${runId}-${++requestNumber}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "x-request-id": requestId,
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    redirect: "manual",
  });
  const rawPayload = await response.text();
  let payload: Envelope<T>;
  try {
    payload = JSON.parse(rawPayload) as Envelope<T>;
  } catch {
    payload = { data: null, error: { code: "NON_JSON_RESPONSE", message: `Expected JSON but received ${response.headers.get("content-type") ?? "an unknown content type"}.` } };
  }
  return { response, payload };
}

function hasForbiddenKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  const record = value as Record<string, unknown>;
  const forbidden = ["storagePath", "passwordHash", "tokenHash", "visitorTokenHash", "messageContent", "chunkContent"];
  return Object.keys(record).some((key) => forbidden.includes(key)) || Object.values(record).some(hasForbiddenKey);
}

await db.connect();
try {
  originalPolicies = (await db.query<PolicyRow>(
    `SELECT key,value,updated_by AS "updatedBy",updated_at AS "updatedAt"
     FROM platform_settings WHERE key=ANY($1::text[])`,
    [policyKeys],
  )).rows;

  await db.query(
    `INSERT INTO users(id,email,password_hash,role,status,display_name,headline,location,bio)
     VALUES ($1,$2,$3,'candidate','active',$4,'Evidence Systems Engineer','Singapore','Builds citation-grounded career Agents.')`,
    [candidateId, candidateEmail, await hashPassword(password), candidateDisplayName],
  );
  await db.query(
    `INSERT INTO materials(id,owner_id,kind,title,storage_path,status,visibility,indexed_at)
     VALUES
       ($1,$3,'file','Public governance evidence',$4,'indexed','public_preview',now()),
       ($2,$3,'file',$5,$6,'indexed','private',now())`,
    [publicMaterialId, privateMaterialId, candidateId, `${candidateId}/${publicMaterialId}/public.md`, privateMarker, `${candidateId}/${privateMaterialId}/${privateMarker}.md`],
  );
  await db.query(
    `INSERT INTO chunks(id,material_id,owner_id,position,content,token_estimate)
     VALUES ($1,$3,$5,0,'Delivered a citation-grounded governance workflow.',8),($2,$4,$5,0,$6,8)`,
    [publicChunkId, privateChunkId, publicMaterialId, privateMaterialId, candidateId, privateMarker],
  );
  await db.query(
    `INSERT INTO knowledge_items(id,owner_id,type,title,summary,highlights,confidence)
     VALUES
       ($1,$3,'project','Governance workflow','A public governance workflow.','["Citation grounded"]'::jsonb,1),
       ($2,$3,'experience','Private governance note',$4,'[]'::jsonb,1)`,
    [publicKnowledgeId, privateKnowledgeId, candidateId, privateMarker],
  );
  await db.query("INSERT INTO knowledge_evidence(knowledge_item_id,chunk_id,owner_id) VALUES ($1,$2,$3),($4,$5,$3)", [publicKnowledgeId, publicChunkId, candidateId, privateKnowledgeId, privateChunkId]);
  await db.query(
    "INSERT INTO agent_settings(owner_id,public_mode,privacy_safe_mode,suggested_questions) VALUES ($1,true,true,'[]'::jsonb)",
    [candidateId],
  );
  await db.query(
    "INSERT INTO publications(id,owner_id,slug,status,published_at) VALUES ($1,$2,$3,'published',now())",
    [publicationId, candidateId, slug],
  );
  await db.query(
    `INSERT INTO conversations(id,owner_id,publication_id,mode,visitor_token_hash,expires_at)
     VALUES ($1,$2,$3,'public',$4,now()+interval '1 hour')`,
    [conversationId, candidateId, publicationId, randomBytes(32).toString("hex")],
  );
  await db.query(
    "INSERT INTO messages(id,conversation_id,owner_id,role,status,content) VALUES ($1,$2,$3,'user','completed',$4)",
    [messageId, conversationId, candidateId, privateMarker],
  );
  await db.query(
    `INSERT INTO content_flags(id,publication_id,message_id,category,severity,safe_summary)
     VALUES ($1,$3,$4,'privacy_boundary','high',$5),($2,$3,NULL,'visitor_negative_feedback','low','Negative public feedback requires review.')`,
    [resolveFlagId, dismissFlagId, publicationId, messageId, safeSummary],
  );

  const candidateCookie = await login(candidateEmail, password);
  const config = getRuntimeConfig();
  const adminCookie = await login(config.bootstrap.adminEmail, config.bootstrap.adminPassword);

  const anonymous = await api("/api/admin/overview");
  assert(anonymous.response.status === 401 && anonymous.payload.error?.code === "UNAUTHENTICATED", "Anonymous Admin API access was not rejected");
  const candidateDenied = await api("/api/admin/overview", { cookie: candidateCookie });
  assert(candidateDenied.response.status === 403 && candidateDenied.payload.error?.code === "FORBIDDEN", "Candidate Admin API access was not rejected");

  const overview = await api<{ recentAgents: Array<{ id: string }>; reviewQueue: Array<{ id: string }>; trend: unknown[] }>("/api/admin/overview?range=7d", { cookie: adminCookie });
  const candidates = await api<{ items: Array<{ id: string; status: string }>; total: number }>(`/api/admin/candidates?search=${encodeURIComponent(candidateDisplayName)}`, { cookie: adminCookie });
  const agents = await api<{ items: Array<{ id: string; status: string }>; total: number }>(`/api/admin/agents?search=${slug}`, { cookie: adminCookie });
  const reviews = await api<{ items: Array<{ id: string; safeSummary: string }>; total: number }>(`/api/admin/reviews?search=${encodeURIComponent(candidateId.slice(0, 8))}`, { cookie: adminCookie });
  const ragTraces = await api<{ items: unknown[]; limit: number }>("/api/admin/rag-traces?limit=5", { cookie: adminCookie });
  const report = await api<{ hasData: boolean; trend: unknown[] }>("/api/admin/reports?range=7d", { cookie: adminCookie });
  const safeSearch = await api<{ candidates: unknown[]; agents: unknown[]; reviews: unknown[] }>(`/api/admin/search?q=${encodeURIComponent(candidateDisplayName)}`, { cookie: adminCookie });
  const privateSearch = await api<{ candidates: unknown[]; agents: unknown[]; reviews: unknown[] }>(`/api/admin/search?q=${encodeURIComponent(privateMarker)}`, { cookie: adminCookie });
  for (const result of [overview, candidates, agents, reviews, ragTraces, report, safeSearch, privateSearch]) assert(result.response.ok, `Admin read API failed with ${result.response.status}`);
  assert(overview.payload.data?.recentAgents.some((item) => item.id === publicationId), "Overview did not project the fixture Agent");
  assert(overview.payload.data?.reviewQueue.some((item) => item.id === resolveFlagId), "Overview did not project the review queue");
  assert(candidates.payload.data?.items.some((item) => item.id === candidateId) && candidates.payload.data.total === 1, "Candidate search was not backed by the fixture account");
  assert(agents.payload.data?.items.some((item) => item.id === publicationId) && agents.payload.data.total === 1, "Agent search was not backed by the fixture publication");
  assert(reviews.payload.data?.items.some((item) => item.id === resolveFlagId && item.safeSummary === safeSummary), "Content Review did not use the safe summary");
  assert(ragTraces.payload.data?.limit === 5, "RAG Trace Admin projection did not enforce the requested bounded limit");
  assert(report.payload.data?.hasData === true && (report.payload.data.trend.length ?? 0) === 7, "Reports did not project the real seven-day fixture trend");
  assert((safeSearch.payload.data?.candidates.length ?? 0) === 1, "Global search did not find the Candidate projection");
  assert((privateSearch.payload.data?.candidates.length ?? 0) + (privateSearch.payload.data?.agents.length ?? 0) + (privateSearch.payload.data?.reviews.length ?? 0) === 0, "Global search crossed the private-content boundary");
  const safeProjection = [overview.payload, candidates.payload, agents.payload, reviews.payload, ragTraces.payload, report.payload, safeSearch.payload, {
    candidates: privateSearch.payload.data?.candidates,
    agents: privateSearch.payload.data?.agents,
    reviews: privateSearch.payload.data?.reviews,
  }];
  assert(!JSON.stringify(safeProjection).includes(privateMarker), "An Admin projection exposed the private fixture marker");
  assert(!hasForbiddenKey(safeProjection), "An Admin projection exposed a forbidden private field name");

  const invalidSuspend = await api(`/api/admin/candidates/${candidateId}`, { cookie: adminCookie, method: "PATCH", body: { status: "suspended", reason: "x" } });
  assert(invalidSuspend.response.status === 400 && invalidSuspend.payload.error?.code === "INVALID_CANDIDATE_STATUS", "Invalid Candidate governance input was not rejected");
  const suspended = await api<{ status: string }>(`/api/admin/candidates/${candidateId}`, { cookie: adminCookie, method: "PATCH", body: { status: "suspended", reason: "Verify immediate governance propagation." } });
  assert(suspended.response.ok && suspended.payload.data?.status === "suspended", "Candidate suspension failed");
  const oldSessionAfterSuspend = await api("/api/auth/me", { cookie: candidateCookie });
  assert(oldSessionAfterSuspend.response.status === 401, "Candidate suspension did not revoke the existing session");
  assert((await fetch(`${baseUrl}/api/public/agents/${slug}`)).status === 404, "Suspended Candidate remained publicly available");
  const restoredCandidate = await api<{ status: string }>(`/api/admin/candidates/${candidateId}`, { cookie: adminCookie, method: "PATCH", body: { status: "active", reason: "Restore the verified fixture account." } });
  assert(restoredCandidate.response.ok && restoredCandidate.payload.data?.status === "active", "Candidate restoration failed");
  assert((await api("/api/auth/me", { cookie: candidateCookie })).response.status === 401, "Candidate restoration incorrectly restored an old session");
  await login(candidateEmail, password);
  assert((await fetch(`${baseUrl}/api/public/agents/${slug}`)).ok, "Restored Candidate public Agent did not recover");

  const paused = await api<{ status: string }>(`/api/admin/agents/${publicationId}`, { cookie: adminCookie, method: "PATCH", body: { action: "pause", reason: "Verify immediate public Agent governance." } });
  assert(paused.response.ok && paused.payload.data?.status === "paused", "Published Agent pause failed");
  assert((await fetch(`${baseUrl}/api/public/agents/${slug}`)).status === 404, "Paused Agent remained publicly available");
  const restoredAgent = await api<{ status: string }>(`/api/admin/agents/${publicationId}`, { cookie: adminCookie, method: "PATCH", body: { action: "restore", reason: "Restore the verified public Agent." } });
  assert(restoredAgent.response.ok && restoredAgent.payload.data?.status === "published", "Published Agent restore failed");
  assert((await fetch(`${baseUrl}/api/public/agents/${slug}`)).ok, "Restored public Agent did not recover");

  const reviewing = await api<{ status: string }>(`/api/admin/reviews/${resolveFlagId}`, { cookie: adminCookie, method: "PATCH", body: { action: "review", note: "Review ownership accepted." } });
  const resolved = await api<{ status: string }>(`/api/admin/reviews/${resolveFlagId}`, { cookie: adminCookie, method: "PATCH", body: { action: "resolve", note: "Safe review completed without private content access." } });
  const dismissed = await api<{ status: string }>(`/api/admin/reviews/${dismissFlagId}`, { cookie: adminCookie, method: "PATCH", body: { action: "dismiss", note: "Feedback item safely dismissed after review." } });
  assert(reviewing.payload.data?.status === "reviewing" && resolved.payload.data?.status === "resolved" && dismissed.payload.data?.status === "dismissed", "Content Review state transitions failed");

  const settings = await api<{ health: { migration: { status: string }; mail: { status: string } }; policies: { publicChatMinuteLimit: number } }>("/api/admin/settings", { cookie: adminCookie });
  assert(settings.response.ok && settings.payload.data?.health.migration.status === "ready", "Admin Settings did not report the current migration");
  const previousMinuteLimit = settings.payload.data?.policies.publicChatMinuteLimit;
  assert(typeof previousMinuteLimit === "number", "Admin Settings did not return public Chat policies");
  const nextMinuteLimit = previousMinuteLimit === 60 ? 59 : previousMinuteLimit + 1;
  const updatedSettings = await api<{ policies: { publicChatMinuteLimit: number } }>("/api/admin/settings", { cookie: adminCookie, method: "PATCH", body: { publicChatMinuteLimit: nextMinuteLimit } });
  assert(updatedSettings.response.ok && updatedSettings.payload.data?.policies.publicChatMinuteLimit === nextMinuteLimit, "Platform policy update did not persist");
  const persistedPolicy = await db.query<{ value: number }>("SELECT value FROM platform_settings WHERE key='public_chat_minute_limit'");
  assert(persistedPolicy.rows[0]?.value === nextMinuteLimit, "Platform policy API result did not match PostgreSQL");

  let invitationCapability = "configured-not-sent";
  if (settings.payload.data?.health.mail.status !== "configured") {
    const invitation = await api("/api/admin/invitations", { cookie: adminCookie, method: "POST", body: { email: `${candidateId}@example.invalid`, displayName: "Smoke Admin" } });
    assert(invitation.response.status === 409 && invitation.payload.error?.code === "MAIL_NOT_CONFIGURED", "Unavailable SMTP was reported as a successful invitation");
    const invitationCount = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM admin_invitations WHERE invited_by=(SELECT id FROM users WHERE email=$1)", [config.bootstrap.adminEmail]);
    assert((invitationCount.rows[0]?.count ?? 0) === 0, "SMTP-unavailable invitation created a fake persistent success");
    invitationCapability = "not-configured-explicit";
  }

  const audits = await db.query<{ action: string; metadata: unknown }>("SELECT action,metadata FROM audit_events WHERE request_id LIKE $1 ORDER BY created_at", [`${runId}-%`]);
  const auditActions = new Set(audits.rows.map((row) => row.action));
  for (const expected of ["admin.candidate.status", "admin.publication.pause", "admin.publication.restore", "admin.content.review", "admin.content.resolve", "admin.content.dismiss", "admin.settings.update"]) {
    assert(auditActions.has(expected), `Missing governance audit action ${expected}`);
  }
  assert(!JSON.stringify(audits.rows).includes(privateMarker), "Governance audit metadata exposed private content");

  console.info(JSON.stringify({
    event: "smoke.admin.completed",
    roleBoundary: true,
    realAggregates: true,
    safeProjection: true,
    candidateSessionRevoked: true,
    candidatePublicPropagation: true,
    agentPublicPropagation: true,
    reviewStateMachine: true,
    policyPersistence: true,
    auditActions: auditActions.size,
    invitationCapability,
  }));
} finally {
  await db.query("DELETE FROM platform_settings WHERE key=ANY($1::text[])", [policyKeys]).catch(() => undefined);
  for (const row of originalPolicies) {
    await db.query(
      "INSERT INTO platform_settings(key,value,updated_by,updated_at) VALUES ($1,$2::jsonb,$3,$4)",
      [row.key, JSON.stringify(row.value), row.updatedBy, row.updatedAt],
    ).catch(() => undefined);
  }
  await db.query("DELETE FROM audit_events WHERE request_id LIKE $1", [`${runId}-%`]).catch(() => undefined);
  await db.query("DELETE FROM users WHERE id=$1", [candidateId]).catch(() => undefined);
  await db.end();
}
