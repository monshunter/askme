export {};

const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.ASKME_CANDIDATE_EMAIL;
const password = process.env.ASKME_CANDIDATE_PASSWORD;
if (!email || !password) throw new Error("ASKME_CANDIDATE_EMAIL and ASKME_CANDIDATE_PASSWORD are required");

const repositoryUrl = "https://github.com/QuantumNous/new-api";
const commitSha = "ccd535ef8e50cf6e5846a59278c40b7ff59d1b7d";

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  redirect: "manual",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (login.status !== 200) throw new Error(`Candidate login failed with status ${login.status}`);
const loginCookie = login.headers.get("set-cookie")?.split(";", 1)[0];
if (!loginCookie) throw new Error("Candidate login did not return a session cookie");
const cookie: string = loginCookie;

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { cookie, ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } });
  const payload = (await response.json()) as { data: unknown; error: { code: string; message: string } | null };
  return { response, payload };
}

const page = await fetch(`${baseUrl}/workspace/repositories`, { headers: { cookie } });
const pageHtml = await page.text();
if (page.status !== 200 || !pageHtml.includes("Code Repositories")) throw new Error("Repository workspace page did not render");

const initial = await request("/api/repositories");
if (initial.response.status !== 200 || !Array.isArray((initial.payload.data as { items?: unknown[] })?.items) || (initial.payload.data as { items: unknown[] }).items.length !== 0) {
  throw new Error("Repository list was not initially empty");
}

const created = await request("/api/repositories", {
  method: "POST",
  body: JSON.stringify({ repositoryUrl, ref: commitSha, visibility: "private", excludePatterns: ["bin/**"] }),
});
const repository = created.payload.data as { id?: string; visibility?: string; latestRevision?: { id?: string; commitSha?: string; state?: string; fileCount?: number } } | null;
if (created.response.status !== 201 || !repository?.id || repository.latestRevision?.commitSha !== commitSha || repository.latestRevision.state !== "stored" || !repository.latestRevision.fileCount) {
  throw new Error(`Repository create/sync failed: ${created.payload.error?.code ?? created.response.status}`);
}

const updated = await request(`/api/repositories/${repository.id}`, { method: "PATCH", body: JSON.stringify({ visibility: "agent_only" }) });
const updatedRepository = updated.payload.data as { visibility?: string; analysisRun?: { id?: string; state?: string; errorCode?: string } } | null;
if (updated.response.status !== 200 || updatedRepository?.visibility !== "agent_only" || !updatedRepository.analysisRun?.id || updatedRepository.analysisRun.state === "unavailable") {
  throw new Error(`Repository visibility update did not queue analysis: ${updatedRepository?.analysisRun?.errorCode ?? updated.response.status}`);
}

const resynced = await request(`/api/repositories/${repository.id}/sync`, { method: "POST", body: JSON.stringify({ ref: commitSha, excludePatterns: ["bin/**"] }) });
const repeated = resynced.payload.data as { id?: string; latestRevision?: { id?: string; commitSha?: string }; analysisRun?: { id?: string; state?: string; errorCode?: string } } | null;
const repeatedRevision = repeated?.latestRevision;
if (resynced.response.status !== 200 || repeated?.id !== repository.id || repeatedRevision?.id !== repository.latestRevision.id || repeatedRevision?.commitSha !== commitSha || !repeated.analysisRun?.id || repeated.analysisRun.state === "unavailable") {
  throw new Error("Repository idempotent re-sync failed");
}

const terminal = await request("/api/repositories");
const items = (terminal.payload.data as { items?: Array<{ id: string; visibility: string; latestRevision?: { commitSha?: string } }> })?.items ?? [];
if (terminal.response.status !== 200 || items.length !== 1 || items[0]?.id !== repository.id || items[0]?.visibility !== "agent_only" || items[0]?.latestRevision?.commitSha !== commitSha) {
  throw new Error("Repository terminal list state is inconsistent");
}

console.info(JSON.stringify({ event: "smoke.repository-api.completed", pageRendered: true, fullShaPinned: true, visibilityUpdated: true, idempotentResync: true, fileCount: repository.latestRevision.fileCount }));
