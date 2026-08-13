import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";
const expectedRepository = process.env.ASKME_FIXED_REPOSITORY_URL ?? "https://github.com/QuantumNous/new-api";
const expectedCommit = process.env.ASKME_FIXED_REPOSITORY_COMMIT ?? "ccd535ef8e50cf6e5846a59278c40b7ff59d1b7d";
const publicBenchmarkRepository = "https://github.com/QuantumNous/new-api";
const tokenEnvironmentKey = process.env.ASKME_FIXED_REPOSITORY_TOKEN_ENV?.trim();
const revokeAfterAcceptance = process.env.ASKME_FIXED_REPOSITORY_REVOKE === "true";
const existingOnly = process.env.ASKME_FIXED_REPOSITORY_EXISTING_ONLY === "true";

async function userEnvValue(key: string) {
  try {
    const source = await readFile(path.join(os.homedir(), ".env"), "utf8");
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=\\s*(.*?)\\s*$`, "m"));
    if (!match) return undefined;
    const value = match[1]!.trim();
    return value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) ? value.slice(1, -1) : value;
  } catch {
    return undefined;
  }
}

const email = process.env.ASKME_CANDIDATE_EMAIL ?? await userEnvValue("ASKME_CANDIDATE_EMAIL") ?? "candidate@askme.local";
const password = process.env.ASKME_CANDIDATE_PASSWORD ?? await userEnvValue("ASKME_CANDIDATE_PASSWORD") ?? "Candidate-local-2026!";
const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (login.status !== 200) throw new Error(`Candidate login failed with status ${login.status}`);
const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
if (!cookie) throw new Error("Candidate login did not return a session cookie");
const sessionCookie: string = cookie;

type Envelope<T> = { data: T | null; error: { code: string; message: string } | null };
async function request<T>(pathname: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { cookie: sessionCookie, ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  return { response, payload: await response.json() as Envelope<T> };
}

type Repository = {
  id: string;
  canonicalUrl: string;
  visibility: "private" | "agent_only" | "citation_allowed" | "public_preview";
  latestRevision: null | { id: string; commitSha: string; fileCount: number };
  latestAnalysisRun: null | { id: string; state: string; phase: string; safeErrorCode: string | null };
};
let repositories = await request<{ items: Repository[] }>("/api/repositories");
let repository = repositories.payload.data?.items.find((item) => item.canonicalUrl.toLowerCase() === expectedRepository.toLowerCase());

if (tokenEnvironmentKey) {
  const token = await userEnvValue(tokenEnvironmentKey);
  if (!token) throw new Error(`The configured private Repository token is unavailable in ~/.env (${tokenEnvironmentKey})`);
  const synchronized = repository
    ? await request<Repository & { analysisRun?: Repository["latestAnalysisRun"] }>(`/api/repositories/${repository.id}/sync`, {
        method: "POST",
        body: JSON.stringify({ ref: expectedCommit, token, excludePatterns: [] }),
      })
    : await request<Repository & { analysisRun?: Repository["latestAnalysisRun"] }>("/api/repositories", {
        method: "POST",
        body: JSON.stringify({ repositoryUrl: expectedRepository, ref: expectedCommit, token, visibility: "citation_allowed", excludePatterns: [] }),
      });
  if (![200, 201].includes(synchronized.response.status)) {
    throw new Error(synchronized.payload.error?.code ?? `Private Repository sync failed with status ${synchronized.response.status}`);
  }
  repositories = await request<{ items: Repository[] }>("/api/repositories");
  repository = repositories.payload.data?.items.find((item) => item.canonicalUrl.toLowerCase() === expectedRepository.toLowerCase());
  if (repository?.visibility === "private") {
    const enabled = await request<Repository & { analysisRun?: Repository["latestAnalysisRun"] }>(`/api/repositories/${repository.id}`, {
      method: "PATCH",
      body: JSON.stringify({ visibility: "citation_allowed" }),
    });
    if (enabled.response.status !== 200) throw new Error(enabled.payload.error?.code ?? "Private Repository analysis could not be enabled");
    repositories = await request<{ items: Repository[] }>("/api/repositories");
    repository = repositories.payload.data?.items.find((item) => item.canonicalUrl.toLowerCase() === expectedRepository.toLowerCase());
  }
  console.info(JSON.stringify({ event: "fixed-repository-wiki.synced", repository: expectedRepository, commitSha: expectedCommit }));
}
if (!repository || repository.latestRevision?.commitSha !== expectedCommit) throw new Error("The fixed public Repository Revision is unavailable");

let runId: string;
if (existingOnly) {
  if (repository.latestAnalysisRun?.state !== "completed") throw new Error("The fixed Repository has no completed existing Wiki run");
  runId = repository.latestAnalysisRun.id;
  console.info(JSON.stringify({ event: "fixed-repository-wiki.existing", runId, commitSha: expectedCommit, eligibleFileCount: repository.latestRevision.fileCount }));
} else if (repository.latestAnalysisRun && ["pending", "running"].includes(repository.latestAnalysisRun.state)) {
  runId = repository.latestAnalysisRun.id;
  console.info(JSON.stringify({ event: "fixed-repository-wiki.resumed", runId, commitSha: expectedCommit, eligibleFileCount: repository.latestRevision.fileCount }));
} else {
  const queued = await request<{ id: string; state: string }>(`/api/repositories/${repository.id}/dossier/rerun`, { method: "POST" });
  if (queued.response.status !== 202 || !queued.payload.data?.id) throw new Error(queued.payload.error?.code ?? "The fixed Repository Wiki run could not be queued");
  runId = queued.payload.data.id;
  console.info(JSON.stringify({ event: "fixed-repository-wiki.queued", runId, commitSha: expectedCommit, eligibleFileCount: repository.latestRevision.fileCount }));
}

const deadline = Date.now() + 20 * 60_000;
let terminal: Repository["latestAnalysisRun"] = null;
let previousState = "";
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const current = await request<{ items: Repository[] }>("/api/repositories");
  const run = current.payload.data?.items.find((item) => item.id === repository.id)?.latestAnalysisRun ?? null;
  if (!run || run.id !== runId) continue;
  const state = `${run.state}:${run.phase}`;
  if (state !== previousState) {
    console.info(JSON.stringify({ event: "fixed-repository-wiki.progress", runId, state: run.state, phase: run.phase }));
    previousState = state;
  }
  if (["completed", "failed", "cancelled"].includes(run.state)) {
    terminal = run;
    break;
  }
}
if (!terminal) throw new Error("The fixed Repository Wiki run did not finish within 20 minutes");
if (terminal.state !== "completed") throw new Error(`The fixed Repository Wiki run ended as ${terminal.state}:${terminal.safeErrorCode ?? "unknown"}`);

type WikiPage = { id: string; path: string; title: string; generatedMarkdown: string; editedMarkdown: string | null; citations: Array<{ marker: string; path: string }> };
type WikiReview = {
  dossier: null | {
    id: string;
    title: string;
    summary: string;
    commitSha: string;
    generatedVersion: number;
    isActive: boolean;
    pages: WikiPage[];
    coverage: { eligibleFileCount?: number; examinedFileCount?: number; examinedPaths?: string[]; coveredAreas?: string[] };
  };
};
const review = await request<WikiReview>(`/api/repositories/${repository.id}/dossier`);
const wiki = review.payload.data?.dossier;
if (review.response.status !== 200 || !wiki || wiki.commitSha !== expectedCommit) throw new Error("The generated fixed Repository Wiki is unavailable for review");
const markdown = wiki.pages.map((page) => page.generatedMarkdown).join("\n\n");
const sectionCount = (markdown.match(/^##\s+\S.+$/gm) ?? []).length;
const paths = wiki.coverage.examinedPaths ?? [];
const areas = new Set(paths.map((file) => file.includes("/") ? file.split("/", 1)[0]! : "(root)"));
const coveredAreas = new Set((wiki.coverage.coveredAreas ?? []).map((area) => area.trim()).filter(Boolean));
const citations = wiki.pages.flatMap((page) => page.citations);
const minimumExaminedPaths = repository.latestRevision.fileCount >= 100 ? 30 : Math.max(1, Math.min(30, repository.latestRevision.fileCount));
const minimumStructuralAreas = Math.min(5, Math.max(1, Math.ceil(minimumExaminedPaths / 6)));
const structuralAreaCount = Math.max(areas.size, coveredAreas.size);
const quality = {
  pageCount: wiki.pages.length,
  sectionCount,
  hasMermaid: /```mermaid\s*[\s\S]+?```/i.test(markdown),
  examinedPathCount: paths.length,
  topLevelAreaCount: areas.size,
  coveredAreaCount: coveredAreas.size,
  structuralAreaCount,
  citationCount: citations.length,
};
if (
  wiki.pages.length < 1 || wiki.pages.length > 32
  || sectionCount < 8
  || !quality.hasMermaid
  || paths.length < minimumExaminedPaths
  || structuralAreaCount < minimumStructuralAreas
  || citations.length < 8
  || wiki.pages.some((page) => !page.generatedMarkdown.startsWith("# ") || !page.path.endsWith(".md"))
) throw new Error(`The fixed Repository Wiki did not satisfy the broad content-quality acceptance baseline: ${JSON.stringify(quality)}`);

let benchmarkQuestions = 0;
if (expectedRepository === publicBenchmarkRepository) {
  const benchmark = JSON.parse(await readFile(path.resolve("scripts/fixtures/new-api-wiki-benchmark.json"), "utf8")) as {
    repository?: string;
    commitSha?: string;
    questions?: Array<{ id?: string; expectedRoute?: string; keyFacts?: string[]; minimumCitations?: number }>;
  };
  const questions = benchmark.questions ?? [];
  if (
    benchmark.repository !== expectedRepository
    || benchmark.commitSha !== expectedCommit
    || questions.length !== 10
    || new Set(questions.map((question) => question.id)).size !== 10
    || questions.some((question) => !["rag", "deep", "refuse"].includes(question.expectedRoute ?? "") || !question.keyFacts?.length || !Number.isInteger(question.minimumCitations) || question.minimumCitations! < 0)
  ) throw new Error("The fixed public Repository benchmark manifest is invalid");
  const groundedQuestions = questions.filter((question) => question.expectedRoute !== "refuse");
  if (groundedQuestions.some((question) => question.keyFacts!.some((fact) => !markdown.toLowerCase().includes(fact.toLowerCase())))) {
    throw new Error("The generated public Repository Wiki is missing a benchmark key fact");
  }
  if (groundedQuestions.some((question) => citations.length < question.minimumCitations!)) {
    throw new Error("The generated public Repository Wiki does not satisfy a benchmark Citation minimum");
  }
  benchmarkQuestions = questions.length;
}

let visibilityRevoked = false;
if (revokeAfterAcceptance) {
  const revoked = await request<Repository>(`/api/repositories/${repository.id}`, {
    method: "PATCH",
    body: JSON.stringify({ visibility: "private" }),
  });
  if (revoked.response.status !== 200 || revoked.payload.data?.visibility !== "private") {
    throw new Error(revoked.payload.error?.code ?? "Private Repository visibility revocation failed");
  }
  const denied = await request<unknown>(`/api/repositories/${repository.id}/dossier/rerun`, { method: "POST" });
  if (denied.response.status !== 409 || denied.payload.error?.code !== "REPOSITORY_ANALYSIS_PRIVATE") {
    throw new Error(`Private Repository analysis revocation returned an unexpected response: ${denied.response.status}:${denied.payload.error?.code ?? "none"}`);
  }
  visibilityRevoked = true;
}

console.info(JSON.stringify({
  event: "smoke.fixed-repository-wiki.completed",
  runId,
  dossierId: wiki.id,
  generatedVersion: wiki.generatedVersion,
  pendingReview: !wiki.isActive,
  pageCount: wiki.pages.length,
  sectionCount,
  examinedFileCount: paths.length,
  coveredTopLevelAreas: [...areas].sort(),
  citationCount: citations.length,
  mermaidPresent: true,
  markdownBytes: Buffer.byteLength(markdown, "utf8"),
  immutableCommitPinned: true,
  tokenUsedOnlyForSync: Boolean(tokenEnvironmentKey),
  visibilityRevoked,
  benchmarkQuestions,
  quality,
}));
