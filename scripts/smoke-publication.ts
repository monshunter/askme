import { createHash, randomUUID } from "node:crypto";

import { Client } from "pg";

import { hashPassword } from "../src/server/auth/crypto";

const databaseUrl = process.env.DATABASE_URL;
const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3001";
if (!databaseUrl) throw new Error("DATABASE_URL is required");

type Publication = { id?: string; slug?: string; status?: "draft" | "published" | "revoked" | "paused" };
type PublicationResult = { publication?: Publication | null; shareUrl?: string | null; changed?: boolean };
type Overview = PublicationResult & {
  readiness?: { ready?: boolean; checks?: Array<{ key?: string; ready?: boolean }> };
  publicMode?: boolean;
};

const db = new Client({ connectionString: databaseUrl });
const ownerId = randomUUID();
const materialId = randomUUID();
const citationChunkId = randomUUID();
const citationKnowledgeId = randomUUID();
const publicMaterialId = randomUUID();
const publicChunkId = randomUUID();
const publicKnowledgeId = randomUUID();
const agentMaterialId = randomUUID();
const agentChunkId = randomUUID();
const agentKnowledgeId = randomUUID();
const privateMaterialId = randomUUID();
const privateChunkId = randomUUID();
const privateKnowledgeId = randomUUID();
const email = `${ownerId}@local.invalid`;
const password = "Publication-smoke-local-2026!";
const rateScopeKeys: string[] = [];

await db.connect();
try {
  await db.query(
    "INSERT INTO users(id,email,password_hash,role,display_name,headline,bio) VALUES ($1,$2,$3,'candidate','Jordan Lee','Platform Engineer','Builds reliable systems.')",
    [ownerId, email, await hashPassword(password)],
  );
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  if (!login.ok || !cookie) throw new Error(`Publication smoke login failed with ${login.status}`);

  const request = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = (await response.json()) as { data?: unknown; error?: { code?: string } };
    return { response, data: payload.data, errorCode: payload.error?.code };
  };

  const initial = await request("/api/publications/current");
  const initialOverview = initial.data as Overview;
  const failedChecks = initialOverview.readiness?.checks?.filter((check) => !check.ready).map((check) => check.key);
  if (!initial.response.ok || initialOverview.publication !== null || initialOverview.readiness?.ready !== false || JSON.stringify(failedChecks) !== JSON.stringify(["indexed_material", "privacy_confirmation"])) {
    throw new Error(`Initial publishing readiness is invalid: ${JSON.stringify(initialOverview)}`);
  }

  const retiredLinkApi = await fetch(`${baseUrl}/api/publications/link`, { method: "POST", headers: { cookie } });
  if (retiredLinkApi.status !== 404) throw new Error("The retired publication link API remained routable");

  const blockedPublish = await request("/api/publications/publish", "POST");
  if (blockedPublish.response.status !== 409 || blockedPublish.errorCode !== "PUBLISH_NOT_READY") throw new Error("Publishing bypassed readiness checks");

  await db.query(
    `INSERT INTO materials(id,owner_id,kind,title,storage_path,status,visibility,indexed_at)
     VALUES ($1,$2,'file','Publication source',$3,'indexed','citation_allowed',now())`,
    [materialId, ownerId, `${ownerId}/${materialId}/source.md`],
  );
  await db.query(
    `INSERT INTO materials(id,owner_id,kind,title,storage_path,status,visibility,indexed_at) VALUES
       ($1,$2,'file','Public Spotlight',$3,'indexed','public_preview',now()),
       ($4,$2,'file','Agent Secret',$5,'indexed','agent_only',now()),
       ($6,$2,'file','Private Secret',$7,'indexed','private',now())`,
    [publicMaterialId, ownerId, `${ownerId}/${publicMaterialId}/public.md`, agentMaterialId, `${ownerId}/${agentMaterialId}/agent.md`, privateMaterialId, `${ownerId}/${privateMaterialId}/private.md`],
  );
  await db.query(
    `INSERT INTO chunks(id,material_id,owner_id,position,content,token_estimate) VALUES
       ($1,$2,$3,0,'The citation-ready publication source supports public answers.',12),
       ($4,$5,$3,0,'Public Spotlight demonstrates a public platform delivery.',12),
       ($6,$7,$3,0,'Agent Secret must never enter a public projection.',12),
       ($8,$9,$3,0,'Private Secret must never enter any Agent projection.',12)`,
    [citationChunkId, materialId, ownerId, publicChunkId, publicMaterialId, agentChunkId, agentMaterialId, privateChunkId, privateMaterialId],
  );
  await db.query(
    `INSERT INTO knowledge_items(id,owner_id,type,title,summary,highlights,confidence) VALUES
       ($1,$2,'experience','Public delivery evidence','Evidence that can support an answer','[]'::jsonb,.8),
       ($3,$2,'project','Public Spotlight','A deliberately public project highlight','["Public impact"]'::jsonb,1),
       ($4,$2,'skill','Agent Secret','Candidate-preview knowledge only','[]'::jsonb,.9),
       ($5,$2,'summary','Private Secret','Private knowledge only','[]'::jsonb,.9)`,
    [citationKnowledgeId, ownerId, publicKnowledgeId, agentKnowledgeId, privateKnowledgeId],
  );
  await db.query(
    `INSERT INTO knowledge_evidence(knowledge_item_id,chunk_id,owner_id) VALUES
       ($1,$2,$3),($4,$5,$3),($6,$7,$3),($8,$9,$3)`,
    [citationKnowledgeId, citationChunkId, ownerId, publicKnowledgeId, publicChunkId, agentKnowledgeId, agentChunkId, privateKnowledgeId, privateChunkId],
  );
  await db.query("INSERT INTO privacy_policy_states(owner_id,revision) VALUES ($1,1)", [ownerId]);
  await db.query("INSERT INTO privacy_confirmations(owner_id,policy_revision,confirmed_at) VALUES ($1,1,now())", [ownerId]);

  const ready = (await request("/api/publications/current")).data as Overview;
  if (!ready.readiness?.ready) throw new Error(`Ready Candidate remained blocked: ${JSON.stringify(ready.readiness)}`);
  const published = (await request("/api/publications/publish", "POST")).data as PublicationResult;
  const firstSlug = published.publication?.slug;
  if (!published.changed || published.publication?.status !== "published" || !firstSlug?.match(/^[A-Za-z0-9_-]{32}$/) || published.shareUrl !== `${baseUrl}/a/${firstSlug}`) throw new Error("Direct publishing did not create an opaque public link");
  const unchangedPublish = (await request("/api/publications/publish", "POST")).data as PublicationResult;
  if (unchangedPublish.changed !== false || unchangedPublish.publication?.slug !== firstSlug) throw new Error("Repeated publish was not idempotent");
  const publicModeOff = await request("/api/agent/settings", "PATCH", { publicMode: false });
  if (!publicModeOff.response.ok || (await request(`/api/public/agents/${firstSlug}`)).response.status !== 404) throw new Error("Public Mode off did not disable anonymous access");
  const reenabled = (await request("/api/publications/publish", "POST")).data as PublicationResult;
  if (!reenabled.changed || !(await request(`/api/public/agents/${firstSlug}`)).response.ok) throw new Error("Publish action did not restore Public Mode on the existing link");

  const sessionAddress = "198.51.100.9";
  const startSession = async (visitorToken?: string) => {
    const response = await fetch(`${baseUrl}/api/public/agents/${firstSlug}/session`, {
      method: "POST",
      headers: { "x-forwarded-for": sessionAddress, ...(visitorToken ? { "x-askme-visitor-token": visitorToken } : {}) },
    });
    const payload = (await response.json()) as { data?: { conversationId?: string; created?: boolean; visitorToken?: string }; error?: { code?: string } };
    return { response, payload, cookie: response.headers.get("set-cookie") };
  };

  await db.query("UPDATE publications SET status='paused',paused_at=now(),pause_reason='Smoke review',updated_at=now() WHERE owner_id=$1 AND slug=$2", [ownerId, firstSlug]);
  const pausedProfile = await request(`/api/public/agents/${firstSlug}`);
  const pausedPage = await fetch(`${baseUrl}/a/${firstSlug}`);
  const pausedSession = await startSession();
  if (pausedProfile.response.status !== 404 || pausedPage.status !== 404 || pausedSession.response.status !== 404) {
    throw new Error("A paused Agent remained available through a public entry point");
  }
  await db.query("UPDATE publications SET status='published',paused_at=NULL,pause_reason=NULL,updated_at=now() WHERE owner_id=$1 AND slug=$2", [ownerId, firstSlug]);

  const nonexistentSlug = `${firstSlug.slice(0, -1)}${firstSlug.endsWith("A") ? "B" : "A"}`;
  const nonexistentProfile = await request(`/api/public/agents/${nonexistentSlug}`);
  const nonexistentPage = await fetch(`${baseUrl}/a/${nonexistentSlug}`);
  const nonexistentSession = await fetch(`${baseUrl}/api/public/agents/${nonexistentSlug}/session`, { method: "POST" });
  if (nonexistentProfile.response.status !== 404 || nonexistentPage.status !== 404 || nonexistentSession.status !== 404) {
    throw new Error("A nonexistent Agent did not remain uniformly unavailable");
  }

  const firstSession = await startSession();
  const visitorCookie = firstSession.cookie?.split(";", 1)[0];
  const firstVisitorToken = firstSession.payload.data?.visitorToken;
  const firstConversationId = firstSession.payload.data?.conversationId;
  const sessionCookiePolicy = firstSession.cookie?.toLowerCase() ?? "";
  if (!firstSession.response.ok || !firstSession.payload.data?.created || !firstVisitorToken || !visitorCookie || !firstConversationId || !sessionCookiePolicy.includes("httponly") || !sessionCookiePolicy.includes("samesite=lax")) {
    throw new Error("Anonymous visitor session cookie was not created safely");
  }
  const resumedSession = await startSession(firstVisitorToken);
  if (!resumedSession.response.ok || resumedSession.payload.data?.created !== false || resumedSession.payload.data.conversationId !== firstConversationId || resumedSession.payload.data.visitorToken !== firstVisitorToken) {
    throw new Error("Anonymous visitor session did not persist across requests");
  }
  for (let creation = 1; creation < 20; creation += 1) {
    const allowedSession = await startSession();
    if (!allowedSession.response.ok || allowedSession.payload.data?.created !== true) throw new Error(`Session rate limit blocked request ${creation + 1} too early`);
  }
  const limitedSession = await startSession();
  if (limitedSession.response.status !== 429 || limitedSession.payload.error?.code !== "PUBLIC_RATE_LIMITED") throw new Error("Anonymous session creation rate limit did not engage");
  const publicationId = published.publication.id!;
  rateScopeKeys.push(createHash("sha256").update(`session:${publicationId}:${sessionAddress}`).digest("hex"));

  const storedVisitor = await db.query<{ visitorTokenHash: string }>(
    "SELECT visitor_token_hash AS \"visitorTokenHash\" FROM conversations WHERE id=$1 AND mode='public'",
    [firstConversationId],
  );
  const rawVisitorToken = firstVisitorToken;
  if (!storedVisitor.rows[0]?.visitorTokenHash || storedVisitor.rows[0].visitorTokenHash.includes(rawVisitorToken)) throw new Error("Raw visitor credential was stored in the database");

  const publicProjection = await request(`/api/public/agents/${firstSlug}`);
  const publicJson = JSON.stringify(publicProjection.data);
  if (
    !publicProjection.response.ok ||
    !publicJson.includes("Public Spotlight") ||
    publicJson.includes("Agent Secret") ||
    publicJson.includes("Private Secret")
  ) {
    throw new Error("The anonymous public projection leaked hidden knowledge or omitted public evidence");
  }

  const agentPage = await fetch(`${baseUrl}/workspace/agent`, { headers: { cookie } });
  const agentHtml = await agentPage.text();
  const languageSwitcherCount = agentHtml.match(/class="language-switcher/g)?.length ?? 0;
  if (
    !agentPage.ok ||
    !agentHtml.includes("Ready to publish") ||
    !agentHtml.includes(firstSlug) ||
    !agentHtml.includes("Visit Agent") ||
    !agentHtml.includes("Revoke Access") ||
    agentHtml.includes("Candidate Agent Link") ||
    agentHtml.includes('href="/workspace/publish"') ||
    agentHtml.includes("Quick Action") ||
    agentHtml.includes("Invite Interviewers") ||
    agentHtml.includes("问候") ||
    !agentHtml.includes("职问") ||
    !agentHtml.includes('class="global-language-control"') ||
    languageSwitcherCount !== 1
  ) {
    throw new Error("Candidate Agent page did not render the consolidated publication and shell contract");
  }
  const anonymousGlobalPages = await Promise.all([
    fetch(`${baseUrl}/login`),
    fetch(`${baseUrl}/a/${firstSlug}`),
  ]);
  for (const [index, page] of anonymousGlobalPages.entries()) {
    const html = await page.text();
    const switcherCount = html.match(/class="language-switcher/g)?.length ?? 0;
    if (!page.ok || !html.includes('class="global-language-control"') || !html.includes("职问") || html.includes("问候") || switcherCount !== 1) {
      throw new Error(`Anonymous page ${index + 1} did not render exactly one global language switcher`);
    }
  }
  const retiredPublishPage = await fetch(`${baseUrl}/workspace/publish`, { headers: { cookie } });
  const retiredPreviewPage = await fetch(`${baseUrl}/workspace/publish/preview`, { headers: { cookie } });
  const retiredPreviewApi = await fetch(`${baseUrl}/api/publications/preview`, { headers: { cookie } });
  if (retiredPublishPage.status !== 404 || retiredPreviewPage.status !== 404 || retiredPreviewApi.status !== 404 || retiredLinkApi.status !== 404) {
    throw new Error("A retired Candidate publishing page or API remained routable");
  }

  const hiddenUpdate = await request(`/api/privacy/materials/${publicMaterialId}`, "PATCH", { visibility: "private" });
  if (!hiddenUpdate.response.ok) throw new Error("Public highlight visibility could not be changed");
  const afterVisibilityChange = await request(`/api/public/agents/${firstSlug}`);
  const changedJson = JSON.stringify(afterVisibilityChange.data);
  if (!afterVisibilityChange.response.ok || changedJson.includes("Public Spotlight") || changedJson.includes("Agent Secret") || changedJson.includes("Private Secret")) {
    throw new Error("A public request did not apply the latest visibility policy");
  }
  const restoredUpdate = await request(`/api/privacy/materials/${publicMaterialId}`, "PATCH", { visibility: "public_preview" });
  if (!restoredUpdate.response.ok) throw new Error("Public highlight visibility could not be restored");
  if (!(await request("/api/privacy/confirm", "POST")).response.ok) throw new Error("Updated privacy revision could not be reconfirmed");

  const revoked = (await request("/api/publications/revoke", "POST")).data as PublicationResult;
  if (!revoked.changed || revoked.publication?.status !== "revoked" || revoked.publication.slug !== firstSlug) throw new Error("Published Agent did not revoke");
  const oldPublicAccess = await request(`/api/public/agents/${firstSlug}`);
  if (oldPublicAccess.response.status !== 404 || oldPublicAccess.errorCode !== "PUBLIC_AGENT_UNAVAILABLE") throw new Error("A revoked public slug remained available");
  const afterRevoke = (await request("/api/publications/current")).data as Overview;
  if (afterRevoke.publication !== null || afterRevoke.publicMode !== false) throw new Error("Revocation did not remove active access and disable Public Mode");

  const legacyDraftSlug = createHash("sha256").update(`${ownerId}:legacy-draft`).digest("base64url").slice(0, 32);
  await db.query("INSERT INTO publications(owner_id,slug,status) VALUES ($1,$2,'draft')", [ownerId, legacyDraftSlug]);
  if ((await request(`/api/public/agents/${legacyDraftSlug}`)).response.status !== 404) throw new Error("A legacy draft link was public before publishing");
  const legacyPublished = (await request("/api/publications/publish", "POST")).data as PublicationResult;
  if (legacyPublished.publication?.status !== "published" || legacyPublished.publication.slug !== legacyDraftSlug) throw new Error("A legacy draft link did not publish in place");
  if (!(await request(`/api/public/agents/${legacyDraftSlug}`)).response.ok) throw new Error("The published legacy draft was not publicly available");
  const legacyRevoked = (await request("/api/publications/revoke", "POST")).data as PublicationResult;
  if (legacyRevoked.publication?.slug !== legacyDraftSlug || legacyRevoked.publication.status !== "revoked") throw new Error("The published legacy draft could not be revoked");

  const republished = (await request("/api/publications/publish", "POST")).data as PublicationResult;
  const secondSlug = republished.publication?.slug;
  if (!secondSlug || secondSlug === firstSlug || secondSlug === legacyDraftSlug || republished.publication?.status !== "published") throw new Error("Direct republishing reused a revoked link");
  if (!(await request(`/api/public/agents/${secondSlug}`)).response.ok) throw new Error("The directly republished Agent was not publicly available");

  const facts = await db.query<{ active: number; revoked: number; publicMode: boolean; audits: number }>(
    `SELECT
       (SELECT count(*)::int FROM publications WHERE owner_id=$1 AND status IN ('draft','published','paused')) AS active,
       (SELECT count(*)::int FROM publications WHERE owner_id=$1 AND status='revoked') AS revoked,
       (SELECT public_mode FROM agent_settings WHERE owner_id=$1) AS "publicMode",
       (SELECT count(*)::int FROM audit_events WHERE actor_id=$1 AND action LIKE 'publication.%') AS audits`,
    [ownerId],
  );
  const row = facts.rows[0];
  if (!row || row.active !== 1 || row.revoked !== 2 || row.publicMode !== true || row.audits !== 7) {
    throw new Error(`Publication persistence is inconsistent: ${JSON.stringify(row)}`);
  }

  console.log(JSON.stringify({ event: "smoke.publication.completed", readinessBlocked: true, retiredLinkApiUnavailable: true, directPublish: true, opaqueSlug: true, publishIdempotent: true, pausedUnavailable: true, nonexistentUnavailable: true, visitorSession: "persisted", visitorTokenStored: false, sessionRateLimited: true, publicProjectionSafe: true, agentPublicationRendered: true, retiredPublishPagesUnavailable: true, singleGlobalLanguageSwitcher: true, visibilityImmediate: true, hiddenKnowledgeLeak: false, revoked: true, oldSlugUnavailable: true, legacyDraftCompatible: true, republishedWithNewSlug: true, auditEvents: row.audits }));
} finally {
  if (rateScopeKeys.length > 0) await db.query("DELETE FROM public_rate_limits WHERE scope_key=ANY($1::text[])", [rateScopeKeys]).catch(() => undefined);
  await db.query("DELETE FROM users WHERE id=$1", [ownerId]).catch(() => undefined);
  await db.end();
}
