export {};

const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.ASKME_CANDIDATE_EMAIL;
const password = process.env.ASKME_CANDIDATE_PASSWORD;
if (!email || !password) throw new Error("ASKME_CANDIDATE_EMAIL and ASKME_CANDIDATE_PASSWORD are required");

type Envelope<T> = { data: T | null; error: { code: string; message: string } | null };

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (login.status !== 200) throw new Error(`Candidate login failed with status ${login.status}`);
const loginCookie = login.headers.get("set-cookie")?.split(";", 1)[0];
if (!loginCookie) throw new Error("Candidate login did not return a session cookie");
const cookie: string = loginCookie;

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { cookie, ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  return { response, payload: await response.json() as Envelope<T> };
}

const page = await fetch(`${baseUrl}/workspace/repositories`, { headers: { cookie } });
const pageHtml = await page.text();
if (page.status !== 200 || !pageHtml.includes("Code Repositories") || !pageHtml.includes("Review Wiki")) throw new Error("Repository Wiki workspace page did not render");

const repositories = await request<{ items: Array<{ id: string; visibility: string; activeRevision: { id: string; commitSha: string } | null; activeProjectionId: string | null }> }>("/api/repositories");
const repository = repositories.payload.data?.items[0];
if (repositories.response.status !== 200 || !repository?.id || !repository.activeRevision || !repository.activeProjectionId) throw new Error("Repository fixture did not expose active Wiki knowledge");

const unauthorized = await fetch(`${baseUrl}/api/repositories/${repository.id}/dossier`);
if (unauthorized.status !== 401) throw new Error("Anonymous visitor accessed Candidate Wiki review data");

type WikiPage = { id: string; path: string; generatedMarkdown: string; editedMarkdown: string | null; citations: unknown[] };
type DossierReview = {
  repository: { activeRevisionId: string | null; activeProjectionId: string | null };
  dossier: null | { id: string; revisionId: string; generatedVersion: number; isActive: boolean; outdatedReason: string | null; projectionId: string | null; projectionState: string | null; pages: WikiPage[]; coverage: { eligibleFileCount?: number; examinedFileCount?: number } };
};
const loaded = await request<DossierReview>(`/api/repositories/${repository.id}/dossier`);
const dossier = loaded.payload.data?.dossier;
const wikiPage = dossier?.pages[0];
if (loaded.response.status !== 200 || !dossier?.isActive || dossier.generatedVersion !== 2 || !dossier.outdatedReason || !wikiPage?.citations.length || !wikiPage.generatedMarkdown.includes("# Repository Wiki") || dossier.coverage.examinedFileCount !== 1) {
  throw new Error("Candidate Wiki review response is incomplete");
}

const approvedMarkdown = wikiPage.generatedMarkdown.replace("exports an answer for consumers", "exports the API-approved answer for consumers");
const changed = await request<{ projectionId: string; page: { pageId: string; editedMarkdown: string | null } }>(`/api/repositories/${repository.id}/dossier/projection`, {
  method: "PATCH",
  body: JSON.stringify({ pageId: wikiPage.id, editedMarkdown: approvedMarkdown }),
});
if (changed.response.status !== 200 || changed.payload.data?.page.pageId !== wikiPage.id || changed.payload.data.page.editedMarkdown !== approvedMarkdown) throw new Error("Candidate Wiki page edit failed");

const draftWhileActive = await request<DossierReview>(`/api/repositories/${repository.id}/dossier`);
if (draftWhileActive.payload.data?.dossier?.isActive || draftWhileActive.payload.data?.dossier?.projectionState !== "draft" || draftWhileActive.payload.data.repository.activeProjectionId !== repository.activeProjectionId) {
  throw new Error("Editing a draft Wiki Projection replaced the still-active approved knowledge version");
}

const missingPage = await request<unknown>(`/api/repositories/${repository.id}/dossier/projection`, {
  method: "PATCH",
  body: JSON.stringify({ pageId: "99999999-9999-4999-8999-999999999999", editedMarkdown: null }),
});
if (missingPage.response.status !== 404 || missingPage.payload.error?.code !== "WIKI_PAGE_NOT_FOUND") throw new Error("Unknown Wiki page did not fail safely");

const approved = await request<{ activeRevisionId: string; activeProjectionId: string }>(`/api/repositories/${repository.id}/dossier/approve`, {
  method: "POST",
  body: JSON.stringify({ dossierId: dossier.id }),
});
if (approved.response.status !== 200 || approved.payload.data?.activeRevisionId !== dossier.revisionId || !approved.payload.data.activeProjectionId) throw new Error("Candidate Wiki approval failed");

const terminal = await request<DossierReview>(`/api/repositories/${repository.id}/dossier`);
const terminalPage = terminal.payload.data?.dossier?.pages.find((candidate) => candidate.id === wikiPage.id);
if (!terminal.payload.data?.dossier?.isActive || terminalPage?.editedMarkdown !== approvedMarkdown) {
  throw new Error("Approved Wiki projection was not returned as active knowledge");
}

const lowered = await request<{ visibility: string }>(`/api/repositories/${repository.id}`, { method: "PATCH", body: JSON.stringify({ visibility: "private" }) });
if (lowered.response.status !== 200 || lowered.payload.data?.visibility !== "private") throw new Error("Repository visibility lowering failed");
const deniedApproval = await request<unknown>(`/api/repositories/${repository.id}/dossier/approve`, { method: "POST", body: JSON.stringify({ dossierId: dossier.id }) });
if (deniedApproval.response.status !== 409 || deniedApproval.payload.error?.code !== "DOSSIER_REPOSITORY_PRIVATE") throw new Error("Private Repository allowed Wiki approval");

console.info(JSON.stringify({
  event: "smoke.repository-wiki-api.completed",
  pageRendered: true,
  anonymousDenied: true,
  coverageVisible: true,
  projectionEdited: true,
  activePreservedDuringDraftEdit: true,
  invalidPageRejected: true,
  approvalActivatedKnowledge: true,
  visibilityLoweringImmediate: true,
}));
