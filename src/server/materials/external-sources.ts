import { load } from "cheerio";

import { AppError } from "@/server/errors";

import { assertSafeRemoteUrl, pinnedPublicFetch, systemHostLookup, type HostLookup } from "./remote-url";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const NOTION_VERSION = "2026-03-11";
const GITHUB_VERSION = "2026-03-10";
const NOTION_API = "https://api.notion.com/v1";
const GITHUB_API = "https://api.github.com";

export type ExternalFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type ExternalSourceInput =
  | { kind: "website"; url: string }
  | { kind: "github"; url: string; token?: string }
  | { kind: "notion"; url: string; targetType: "page" | "database"; token?: string };

export type ExternalSnapshot = {
  kind: ExternalSourceInput["kind"];
  title: string;
  externalUrl: string;
  content: string;
  sourceMeta: Record<string, unknown>;
};

type SnapshotDependencies = { fetcher?: ExternalFetch; lookup?: HostLookup };

async function boundedText(response: Response, limit = MAX_RESPONSE_BYTES) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limit) throw new AppError("SOURCE_TOO_LARGE", "The source response is too large to import.", 413);
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new AppError("SOURCE_TOO_LARGE", "The source response is too large to import.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function request(fetcher: ExternalFetch, url: string, init: RequestInit, provider: "website" | "github" | "notion") {
  try {
    return await fetcher(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("SOURCE_FETCH_FAILED", `The ${provider} source could not be fetched.`, 502);
  }
}

async function jsonResponse(response: Response, provider: "github" | "notion") {
  const text = await boundedText(response);
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 || response.status === 404 ? "SOURCE_ACCESS_DENIED" : "SOURCE_UPSTREAM_ERROR";
    throw new AppError(code, `The ${provider} source is unavailable or not shared with the supplied credentials.`, response.status === 429 ? 429 : 422);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AppError("SOURCE_RESPONSE_INVALID", `The ${provider} source returned invalid data.`, 502);
  }
}

function normalizeWhitespace(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function websiteSnapshot(input: Extract<ExternalSourceInput, { kind: "website" }>, dependencies: Required<SnapshotDependencies>): Promise<ExternalSnapshot> {
  let current = await assertSafeRemoteUrl(input.url, dependencies.lookup);
  let response: Response | undefined;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    response = await request(dependencies.fetcher, current.toString(), { method: "GET", redirect: "manual", headers: { accept: "text/html,text/plain;q=0.9" } }, "website");
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (redirect === MAX_REDIRECTS) throw new AppError("TOO_MANY_REDIRECTS", "The website redirected too many times.", 422);
    const location = response.headers.get("location");
    if (!location) throw new AppError("INVALID_SOURCE_REDIRECT", "The website returned an invalid redirect.", 422);
    current = await assertSafeRemoteUrl(new URL(location, current).toString(), dependencies.lookup);
  }
  if (!response?.ok) throw new AppError("SOURCE_UPSTREAM_ERROR", "The website source returned an unsuccessful response.", 422);

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!(contentType.includes("text/html") || contentType.includes("text/plain") || contentType.includes("application/xhtml+xml"))) {
    throw new AppError("UNSUPPORTED_SOURCE_CONTENT", "The website must return HTML or plain text.", 415);
  }
  const body = await boundedText(response);
  let title = current.hostname;
  let content = body;
  if (!contentType.includes("text/plain")) {
    const $ = load(body);
    $("script,style,noscript,svg,template").remove();
    title = normalizeWhitespace($("title").first().text()) || normalizeWhitespace($("h1").first().text()) || title;
    content = normalizeWhitespace($("body").text());
  }
  content = normalizeWhitespace(content);
  if (!content) throw new AppError("SOURCE_CONTENT_EMPTY", "The website did not contain importable text.", 422);
  return {
    kind: "website",
    title: title.slice(0, 300),
    externalUrl: current.toString(),
    content,
    sourceMeta: { provider: "website", finalUrl: current.toString(), fetchedAt: new Date().toISOString() },
  };
}

function githubRepository(url: URL) {
  if (!(url.hostname === "github.com" || url.hostname === "www.github.com")) {
    throw new AppError("INVALID_GITHUB_URL", "Enter a GitHub repository URL.", 400);
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) throw new AppError("INVALID_GITHUB_URL", "Enter a GitHub repository URL in the form github.com/owner/repository.", 400);
  const owner = segments[0];
  const repository = segments[1]?.replace(/\.git$/i, "");
  if (!owner || !repository || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new AppError("INVALID_GITHUB_URL", "Enter a valid GitHub repository URL.", 400);
  }
  return { owner, repository };
}

async function githubSnapshot(input: Extract<ExternalSourceInput, { kind: "github" }>, dependencies: Required<SnapshotDependencies>): Promise<ExternalSnapshot> {
  const sourceUrl = await assertSafeRemoteUrl(input.url, dependencies.lookup);
  const { owner, repository } = githubRepository(sourceUrl);
  const headers = new Headers({ accept: "application/vnd.github+json", "user-agent": "askme-local", "x-github-api-version": GITHUB_VERSION });
  if (input.token?.trim()) headers.set("authorization", `Bearer ${input.token.trim()}`);

  const repoResponse = await request(dependencies.fetcher, `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, { headers }, "github");
  const repo = await jsonResponse(repoResponse, "github");
  const fullName = typeof repo.full_name === "string" ? repo.full_name : `${owner}/${repository}`;
  const canonicalUrl = typeof repo.html_url === "string" ? repo.html_url : `https://github.com/${owner}/${repository}`;
  const description = typeof repo.description === "string" ? repo.description : "";
  const defaultBranch = typeof repo.default_branch === "string" ? repo.default_branch : null;
  const topics = Array.isArray(repo.topics) ? repo.topics.filter((value): value is string => typeof value === "string").slice(0, 50) : [];
  const metadata = [
    `Repository: ${fullName}`,
    description && `Description: ${description}`,
    typeof repo.language === "string" && `Primary language: ${repo.language}`,
    topics.length > 0 && `Topics: ${topics.join(", ")}`,
    defaultBranch && `Default branch: ${defaultBranch}`,
  ].filter(Boolean);

  const readmeResponse = await request(
    dependencies.fetcher,
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/readme`,
    { headers: new Headers({ ...Object.fromEntries(headers), accept: "application/vnd.github.raw+json" }) },
    "github",
  );
  if (readmeResponse.ok) {
    const readme = normalizeWhitespace(await boundedText(readmeResponse, 3 * 1024 * 1024));
    if (readme) metadata.push("\nREADME\n", readme);
  } else if (readmeResponse.status !== 404) {
    await jsonResponse(readmeResponse, "github");
  }

  return {
    kind: "github",
    title: fullName.slice(0, 300),
    externalUrl: canonicalUrl,
    content: metadata.join("\n"),
    sourceMeta: {
      provider: "github",
      repository: fullName,
      defaultBranch,
      language: typeof repo.language === "string" ? repo.language : null,
      visibility: typeof repo.visibility === "string" ? repo.visibility : null,
      topics,
      fetchedAt: new Date().toISOString(),
    },
  };
}

function notionTarget(url: URL) {
  if (!(url.hostname === "notion.so" || url.hostname === "www.notion.so" || url.hostname.endsWith(".notion.site"))) {
    throw new AppError("INVALID_NOTION_URL", "Enter a Notion page or database URL.", 400);
  }
  const compact = url.pathname.match(/[0-9a-f]{32}/i)?.[0];
  if (!compact) throw new AppError("INVALID_NOTION_URL", "The Notion URL must contain a page or database identifier.", 400);
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`.toLowerCase();
}

function richText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((part) => (part && typeof part === "object" && "plain_text" in part && typeof part.plain_text === "string" ? part.plain_text : "")).join("");
}

function pagePropertiesText(properties: unknown) {
  if (!properties || typeof properties !== "object") return "";
  return Object.values(properties)
    .map((property) => {
      if (!property || typeof property !== "object") return "";
      const value = property as Record<string, unknown>;
      return richText(value.title) || richText(value.rich_text) || (typeof value.url === "string" ? value.url : "");
    })
    .filter(Boolean)
    .join(" | ");
}

function blockText(block: unknown) {
  if (!block || typeof block !== "object") return "";
  const value = block as Record<string, unknown>;
  const type = typeof value.type === "string" ? value.type : "";
  const body = type && value[type] && typeof value[type] === "object" ? (value[type] as Record<string, unknown>) : {};
  return richText(body.rich_text) || richText(body.caption) || (typeof body.title === "string" ? body.title : "") || (typeof body.expression === "string" ? body.expression : "");
}

type NotionContext = {
  fetcher: ExternalFetch;
  headers: Headers;
  visitedBlocks: number;
};

async function notionChildren(blockId: string, context: NotionContext, depth = 0): Promise<string[]> {
  if (depth > 8 || context.visitedBlocks >= 500) return [];
  const lines: string[] = [];
  let cursor: string | null = null;
  do {
    const endpoint = new URL(`${NOTION_API}/blocks/${encodeURIComponent(blockId)}/children`);
    endpoint.searchParams.set("page_size", "100");
    if (cursor) endpoint.searchParams.set("start_cursor", cursor);
    const response = await request(context.fetcher, endpoint.toString(), { headers: context.headers }, "notion");
    const payload = await jsonResponse(response, "notion");
    const results = Array.isArray(payload.results) ? payload.results : [];
    for (const block of results) {
      if (context.visitedBlocks >= 500) break;
      context.visitedBlocks += 1;
      const text = blockText(block);
      if (text) lines.push(text);
      if (block && typeof block === "object" && block.has_children === true && typeof block.id === "string") {
        lines.push(...(await notionChildren(block.id, context, depth + 1)));
      }
    }
    cursor = payload.has_more === true && typeof payload.next_cursor === "string" ? payload.next_cursor : null;
  } while (cursor && context.visitedBlocks < 500);
  return lines;
}

async function notionSnapshot(input: Extract<ExternalSourceInput, { kind: "notion" }>, dependencies: Required<SnapshotDependencies>): Promise<ExternalSnapshot> {
  if (!input.token?.trim()) throw new AppError("NOTION_TOKEN_REQUIRED", "Provide a Notion integration token with read access to this source.", 400);
  const sourceUrl = await assertSafeRemoteUrl(input.url, dependencies.lookup);
  const targetId = notionTarget(sourceUrl);
  const headers = new Headers({ authorization: `Bearer ${input.token.trim()}`, "content-type": "application/json", "notion-version": NOTION_VERSION });
  const context: NotionContext = { fetcher: dependencies.fetcher, headers, visitedBlocks: 0 };

  let title = "Notion source";
  const lines: string[] = [];
  const sourceMeta: Record<string, unknown> = { provider: "notion", targetType: input.targetType, fetchedAt: new Date().toISOString() };
  if (input.targetType === "page") {
    const page = await jsonResponse(await request(dependencies.fetcher, `${NOTION_API}/pages/${targetId}`, { headers }, "notion"), "notion");
    title = pagePropertiesText(page.properties) || title;
    lines.push(title, ...(await notionChildren(targetId, context)));
    sourceMeta.pageId = targetId;
  } else {
    const database = await jsonResponse(await request(dependencies.fetcher, `${NOTION_API}/databases/${targetId}`, { headers }, "notion"), "notion");
    title = richText(database.title) || title;
    const dataSources = Array.isArray(database.data_sources) ? database.data_sources : [];
    if (dataSources.length === 0) throw new AppError("NOTION_DATA_SOURCE_MISSING", "The Notion database does not expose a readable data source.", 422);
    lines.push(title);
    for (const item of dataSources.slice(0, 10)) {
      if (!item || typeof item !== "object" || typeof item.id !== "string") continue;
      let cursor: string | null = null;
      do {
        const response = await request(
          dependencies.fetcher,
          `${NOTION_API}/data_sources/${encodeURIComponent(item.id)}/query`,
          { method: "POST", headers, body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }) },
          "notion",
        );
        const payload = await jsonResponse(response, "notion");
        const results = Array.isArray(payload.results) ? payload.results : [];
        for (const page of results.slice(0, 100)) {
          if (!page || typeof page !== "object") continue;
          const pageLine = pagePropertiesText(page.properties);
          if (pageLine) lines.push(pageLine);
          if (typeof page.id === "string") lines.push(...(await notionChildren(page.id, context)));
        }
        cursor = payload.has_more === true && typeof payload.next_cursor === "string" ? payload.next_cursor : null;
      } while (cursor && context.visitedBlocks < 500);
    }
    sourceMeta.databaseId = targetId;
    sourceMeta.dataSourceCount = dataSources.length;
  }

  const content = normalizeWhitespace(lines.join("\n"));
  if (!content) throw new AppError("SOURCE_CONTENT_EMPTY", "The Notion source did not contain importable text.", 422);
  return { kind: "notion", title: title.slice(0, 300), externalUrl: sourceUrl.toString(), content, sourceMeta };
}

export async function createExternalSnapshot(input: ExternalSourceInput, dependencies: SnapshotDependencies = {}) {
  const resolved: Required<SnapshotDependencies> = { fetcher: dependencies.fetcher ?? pinnedPublicFetch, lookup: dependencies.lookup ?? systemHostLookup };
  if (input.kind === "website") return websiteSnapshot(input, resolved);
  if (input.kind === "github") return githubSnapshot(input, resolved);
  return notionSnapshot(input, resolved);
}
