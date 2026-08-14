import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

type PageSurface = { role: "anonymous" | "candidate" | "admin"; evidence: string[]; viewports: ["desktop", "mobile"] };
type ApiSurface = { methods: string[]; evidence: string[] };

const pages: Record<string, PageSurface> = {
  "/": { role: "anonymous", evidence: ["browser:anonymous"], viewports: ["desktop", "mobile"] },
  "/login": { role: "anonymous", evidence: ["smoke:auth", "browser:anonymous"], viewports: ["desktop", "mobile"] },
  "/register": { role: "anonymous", evidence: ["smoke:auth", "browser:anonymous"], viewports: ["desktop", "mobile"] },
  "/forgot-password": { role: "anonymous", evidence: ["smoke:auth", "browser:anonymous"], viewports: ["desktop", "mobile"] },
  "/reset-password/[token]": { role: "anonymous", evidence: ["smoke:auth", "browser:anonymous"], viewports: ["desktop", "mobile"] },
  "/invite/[token]": { role: "anonymous", evidence: ["smoke:admin", "browser:anonymous"], viewports: ["desktop", "mobile"] },
  "/a/[slug]": { role: "anonymous", evidence: ["smoke:public-chat", "smoke:publication", "browser:anonymous"], viewports: ["desktop", "mobile"] },
  "/workspace": { role: "candidate", evidence: ["smoke:auth", "browser:candidate"], viewports: ["desktop", "mobile"] },
  "/workspace/account": { role: "candidate", evidence: ["smoke:auth", "browser:candidate"], viewports: ["desktop", "mobile"] },
  "/workspace/materials": { role: "candidate", evidence: ["smoke:material-lifecycle", "smoke:upload", "smoke:connect", "browser:candidate"], viewports: ["desktop", "mobile"] },
  "/workspace/repositories": { role: "candidate", evidence: ["smoke:repository-api", "smoke:repository-dossier-api", "browser:candidate"], viewports: ["desktop", "mobile"] },
  "/workspace/knowledge": { role: "candidate", evidence: ["smoke:material-lifecycle", "smoke:repository-dossier", "browser:candidate"], viewports: ["desktop", "mobile"] },
  "/workspace/privacy": { role: "candidate", evidence: ["smoke:privacy-api", "browser:candidate"], viewports: ["desktop", "mobile"] },
  "/workspace/agent": { role: "candidate", evidence: ["smoke:agent-preview", "smoke:publication", "browser:candidate"], viewports: ["desktop", "mobile"] },
  "/admin": { role: "admin", evidence: ["smoke:admin", "browser:admin"], viewports: ["desktop", "mobile"] },
  "/admin/candidates": { role: "admin", evidence: ["smoke:admin", "browser:admin"], viewports: ["desktop", "mobile"] },
  "/admin/agents": { role: "admin", evidence: ["smoke:admin", "browser:admin"], viewports: ["desktop", "mobile"] },
  "/admin/repositories": { role: "admin", evidence: ["smoke:analysis-governance", "browser:admin"], viewports: ["desktop", "mobile"] },
  "/admin/reports": { role: "admin", evidence: ["smoke:admin", "browser:admin"], viewports: ["desktop", "mobile"] },
  "/admin/reviews": { role: "admin", evidence: ["smoke:admin", "browser:admin"], viewports: ["desktop", "mobile"] },
  "/admin/search": { role: "admin", evidence: ["smoke:admin", "browser:admin"], viewports: ["desktop", "mobile"] },
  "/admin/settings": { role: "admin", evidence: ["smoke:admin", "smoke:analysis-governance", "browser:admin"], viewports: ["desktop", "mobile"] },
};

const api: Record<string, ApiSurface> = {
  "/api/admin/agents": { methods: ["GET"], evidence: ["smoke:admin"] },
  "/api/admin/agents/[publicationId]": { methods: ["PATCH"], evidence: ["smoke:admin"] },
  "/api/admin/analysis-runs/[runId]/cancel": { methods: ["POST"], evidence: ["smoke:analysis-governance", "browser:admin"] },
  "/api/admin/candidates": { methods: ["GET"], evidence: ["smoke:admin"] },
  "/api/admin/candidates/[candidateId]": { methods: ["PATCH"], evidence: ["smoke:admin"] },
  "/api/admin/invitations": { methods: ["POST"], evidence: ["smoke:admin"] },
  "/api/admin/overview": { methods: ["GET"], evidence: ["smoke:admin"] },
  "/api/admin/reports": { methods: ["GET"], evidence: ["smoke:admin"] },
  "/api/admin/repositories": { methods: ["GET"], evidence: ["smoke:analysis-governance", "browser:admin"] },
  "/api/admin/repositories/[repositoryId]": { methods: ["PATCH"], evidence: ["smoke:analysis-governance", "browser:admin"] },
  "/api/admin/repositories/[repositoryId]/analysis/rerun": { methods: ["POST"], evidence: ["smoke:repository-analysis-runner", "browser:admin"] },
  "/api/admin/reviews": { methods: ["GET"], evidence: ["smoke:admin"] },
  "/api/admin/reviews/[flagId]": { methods: ["PATCH"], evidence: ["smoke:admin"] },
  "/api/admin/search": { methods: ["GET"], evidence: ["smoke:admin"] },
  "/api/admin/settings": { methods: ["GET", "PATCH"], evidence: ["smoke:admin", "smoke:analysis-governance"] },
  "/api/agent/analysis-runs/[runId]/events": { methods: ["GET"], evidence: ["smoke:analysis-sse", "browser:candidate"] },
  "/api/agent/messages/[messageId]/feedback": { methods: ["PUT"], evidence: ["smoke:agent-preview"] },
  "/api/agent/preview": { methods: ["GET"], evidence: ["smoke:agent-preview", "smoke:agent-runtime-acceptance"] },
  "/api/agent/preview/chat": { methods: ["POST"], evidence: ["smoke:agent-preview", "smoke:agent-runtime-acceptance", "smoke:repository-analysis-runner"] },
  "/api/agent/settings": { methods: ["GET", "PATCH"], evidence: ["smoke:agent-preview"] },
  "/api/agent/settings/suggestions/refresh": { methods: ["POST"], evidence: ["smoke:agent-preview"] },
  "/api/auth/login": { methods: ["POST"], evidence: ["smoke:auth"] },
  "/api/auth/logout": { methods: ["POST"], evidence: ["smoke:auth"] },
  "/api/auth/me": { methods: ["GET"], evidence: ["smoke:auth"] },
  "/api/auth/register": { methods: ["POST"], evidence: ["smoke:auth"] },
  "/api/auth/forgot-password": { methods: ["POST"], evidence: ["smoke:auth"] },
  "/api/auth/reset-password": { methods: ["POST"], evidence: ["smoke:auth"] },
  "/api/auth/password": { methods: ["POST"], evidence: ["smoke:auth"] },
  "/api/dashboard": { methods: ["GET"], evidence: ["smoke:auth", "browser:candidate"] },
  "/api/health/live": { methods: ["GET"], evidence: ["verify:docker-lifecycle"] },
  "/api/health/ready": { methods: ["GET"], evidence: ["verify:docker-lifecycle", "smoke:analysis-governance"] },
  "/api/invitations/[token]": { methods: ["GET", "POST"], evidence: ["smoke:admin"] },
  "/api/knowledge": { methods: ["GET"], evidence: ["smoke:material-lifecycle", "smoke:repository-dossier"] },
  "/api/knowledge/[knowledgeItemId]": { methods: ["GET", "PATCH"], evidence: ["smoke:material-lifecycle", "browser:candidate"] },
  "/api/knowledge/repositories/[repositoryId]": { methods: ["GET"], evidence: ["smoke:repository-dossier", "browser:candidate"] },
  "/api/materials": { methods: ["GET"], evidence: ["smoke:material-lifecycle"] },
  "/api/materials/[materialId]": { methods: ["DELETE"], evidence: ["smoke:material-lifecycle"] },
  "/api/materials/[materialId]/content": { methods: ["GET"], evidence: ["smoke:material-lifecycle"] },
  "/api/materials/[materialId]/retry": { methods: ["POST"], evidence: ["smoke:material-lifecycle"] },
  "/api/materials/connect": { methods: ["POST"], evidence: ["smoke:connect"] },
  "/api/materials/upload": { methods: ["POST"], evidence: ["smoke:upload"] },
  "/api/preferences/locale": { methods: ["PUT"], evidence: ["browser:anonymous", "browser:candidate", "browser:admin"] },
  "/api/privacy": { methods: ["GET"], evidence: ["smoke:privacy-api"] },
  "/api/privacy/confirm": { methods: ["POST"], evidence: ["smoke:privacy-api"] },
  "/api/privacy/materials/[materialId]": { methods: ["PATCH"], evidence: ["smoke:privacy-api"] },
  "/api/public/agents/[slug]": { methods: ["GET"], evidence: ["smoke:public-chat", "smoke:publication"] },
  "/api/public/agents/[slug]/analysis-runs/[runId]/events": { methods: ["GET"], evidence: ["smoke:analysis-sse", "browser:anonymous"] },
  "/api/public/agents/[slug]/chat": { methods: ["GET", "POST"], evidence: ["smoke:agent-runtime-acceptance", "smoke:public-chat", "smoke:repository-analysis-runner"] },
  "/api/public/agents/[slug]/materials/[materialId]": { methods: ["GET"], evidence: ["smoke:public-chat"] },
  "/api/public/agents/[slug]/messages/[messageId]/feedback": { methods: ["PUT"], evidence: ["smoke:public-chat"] },
  "/api/public/agents/[slug]/repositories/[repositoryId]/source": { methods: ["GET"], evidence: ["smoke:repository-analysis-runner", "browser:anonymous"] },
  "/api/public/agents/[slug]/session": { methods: ["POST"], evidence: ["smoke:agent-runtime-acceptance", "smoke:public-chat"] },
  "/api/public/agents/[slug]/suggestions/refresh": { methods: ["POST"], evidence: ["smoke:public-chat"] },
  "/api/publications/current": { methods: ["GET"], evidence: ["smoke:publication"] },
  "/api/publications/publish": { methods: ["POST"], evidence: ["smoke:publication"] },
  "/api/publications/revoke": { methods: ["POST"], evidence: ["smoke:publication"] },
  "/api/repositories": { methods: ["GET", "POST"], evidence: ["smoke:repository-api"] },
  "/api/repositories/[repositoryId]": { methods: ["PATCH"], evidence: ["smoke:repository-api", "browser:candidate"] },
  "/api/repositories/[repositoryId]/dossier": { methods: ["GET"], evidence: ["smoke:repository-dossier-api"] },
  "/api/repositories/[repositoryId]/dossier/approve": { methods: ["POST"], evidence: ["smoke:repository-dossier-api"] },
  "/api/repositories/[repositoryId]/dossier/projection": { methods: ["PATCH"], evidence: ["smoke:repository-dossier-api"] },
  "/api/repositories/[repositoryId]/dossier/rerun": { methods: ["POST"], evidence: ["smoke:repository-analysis-runner"] },
  "/api/repositories/[repositoryId]/source": { methods: ["GET"], evidence: ["smoke:repository-analysis-runner", "browser:candidate"] },
  "/api/repositories/[repositoryId]/sync": { methods: ["POST"], evidence: ["smoke:repository-api"] },
};

const requiredEntrypoints = [
  "e2e:admin-fixture", "e2e:fixture", "e2e:public-thread-fixture",
  "smoke:api-surface", "smoke:auth", "smoke:connect", "smoke:job-lease", "smoke:material-lifecycle", "smoke:agent-preview", "smoke:agent-runtime-acceptance", "smoke:admin",
  "smoke:privacy-api", "smoke:public-chat", "smoke:publication", "smoke:repository-retention", "smoke:repository-api",
  "smoke:repository-dossier", "smoke:repository-dossier-api", "smoke:analysis-scheduler", "smoke:analysis-sse",
  "smoke:analysis-governance", "smoke:code-agent-sandbox", "smoke:repository-analysis-runner", "smoke:fixed-repository-wiki", "smoke:runtime-state",
  "smoke:upload", "verify:docker-lifecycle",
].sort();

async function walk(root: string, filename: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...await walk(target, filename));
    else if (entry.name === filename) found.push(target);
  }
  return found;
}

function same(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const actualPages = (await walk("src/app", "page.tsx"))
  .map((file) => `/${path.relative("src/app", path.dirname(file)).split(path.sep).join("/")}`.replace(/\/$/, "/"))
  .map((route) => route === "/." ? "/" : route)
  .sort();
const expectedPages = Object.keys(pages).sort();
if (!same(actualPages, expectedPages)) throw new Error(`Page surface drift. actual=${JSON.stringify(actualPages)} expected=${JSON.stringify(expectedPages)}`);

const actualApi: Record<string, string[]> = {};
for (const file of await walk("src/app/api", "route.ts")) {
  const source = await readFile(file, "utf8");
  const route = `/api/${path.relative("src/app/api", path.dirname(file)).split(path.sep).join("/")}`;
  actualApi[route] = [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((match) => match[1]!).sort();
}
const actualRoutes = Object.keys(actualApi).sort();
const expectedRoutes = Object.keys(api).sort();
if (!same(actualRoutes, expectedRoutes)) throw new Error(`API surface drift. actual=${JSON.stringify(actualRoutes)} expected=${JSON.stringify(expectedRoutes)}`);
for (const route of expectedRoutes) {
  if (!same(actualApi[route]!, [...api[route]!.methods].sort())) throw new Error(`API method drift for ${route}`);
  if (api[route]!.evidence.length === 0) throw new Error(`API surface ${route} has no evidence owner`);
}

const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };
const actualEntrypoints = Object.keys(packageJson.scripts).filter((name) => name.startsWith("smoke:") || name.startsWith("e2e:") || name === "verify:docker-lifecycle").sort();
if (!same(actualEntrypoints, requiredEntrypoints)) throw new Error(`Verification entrypoint drift. actual=${JSON.stringify(actualEntrypoints)} expected=${JSON.stringify(requiredEntrypoints)}`);
const evidenceReferences = new Set([...Object.values(pages), ...Object.values(api)].flatMap((surface) => surface.evidence).filter((name) => !name.startsWith("browser:")));
for (const reference of evidenceReferences) if (!packageJson.scripts[reference]) throw new Error(`Surface evidence script ${reference} is missing`);

console.info(JSON.stringify({ event: "surface-matrix.verified", pages: expectedPages.length, apiRoutes: expectedRoutes.length, apiMethods: Object.values(api).reduce((total, surface) => total + surface.methods.length, 0), verificationEntrypoints: requiredEntrypoints.length, browserRoles: ["anonymous", "candidate", "admin"], viewports: ["desktop", "mobile"] }));
