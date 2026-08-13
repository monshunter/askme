import { createHash } from "node:crypto";

import { AppError } from "@/server/errors";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const DEFAULT_MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

export type GitHubFetch = (url: string, init?: RequestInit) => Promise<Response>;

type FetchOptions = {
  fetcher?: GitHubFetch;
  timeoutMs?: number;
  maxArchiveBytes?: number;
};

type GitHubRepository = {
  owner: string;
  repository: string;
  canonicalUrl: string;
  displayName: string;
};

function safeGitHubError(status: number, purpose: "ref" | "archive") {
  if (status === 401 || status === 403 || status === 404) {
    return new AppError("GITHUB_ACCESS_DENIED", "The GitHub repository or revision is unavailable to the supplied request credentials.", 422);
  }
  if (status === 429) return new AppError("GITHUB_RATE_LIMITED", "GitHub is temporarily rate limited.", 503);
  return new AppError(purpose === "ref" ? "GITHUB_REF_FAILED" : "GITHUB_ARCHIVE_FAILED", `GitHub ${purpose} retrieval failed.`, 502);
}

async function fetchWithDeadline(fetcher: GitHubFetch, url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new AppError("GITHUB_TIMEOUT", "GitHub did not respond in time.", 504);
    }
    throw new AppError("GITHUB_UNAVAILABLE", "GitHub is unavailable.", 503);
  } finally {
    clearTimeout(timeout);
  }
}

async function boundedBytes(response: Response, limit: number) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limit) {
    throw new AppError("REPOSITORY_ARCHIVE_TOO_LARGE", "The repository archive exceeds the configured download limit.", 413);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new AppError("REPOSITORY_ARCHIVE_TOO_LARGE", "The repository archive exceeds the configured download limit.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function parseGitHubRepositoryUrl(value: string): GitHubRepository {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("INVALID_REPOSITORY_URL", "Enter a GitHub.com repository URL.", 400);
  }
  if (url.protocol !== "https:" || (url.hostname !== "github.com" && url.hostname !== "www.github.com") || url.username || url.password || url.search || url.hash) {
    throw new AppError("INVALID_REPOSITORY_URL", "Enter a GitHub.com repository URL.", 400);
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) throw new AppError("INVALID_REPOSITORY_URL", "Enter a GitHub.com repository URL in the form github.com/owner/repository.", 400);
  const owner = segments[0];
  const repository = segments[1]?.replace(/\.git$/i, "");
  if (!owner || !repository || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new AppError("INVALID_REPOSITORY_URL", "Enter a valid GitHub.com repository URL.", 400);
  }
  return {
    owner,
    repository,
    canonicalUrl: `https://github.com/${owner}/${repository}`,
    displayName: `${owner}/${repository}`,
  };
}

export async function fetchGitHubRevision(
  input: { repositoryUrl: string; ref: string; token?: string },
  options: FetchOptions = {},
) {
  const repository = parseGitHubRepositoryUrl(input.repositoryUrl);
  const requestedRef = input.ref.trim();
  if (!requestedRef || requestedRef.length > 255 || /[\u0000-\u001f\u007f]/.test(requestedRef)) {
    throw new AppError("INVALID_REPOSITORY_REF", "Enter a branch, tag, or commit SHA.", 400);
  }
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
  const headers = new Headers({
    accept: "application/vnd.github+json",
    "user-agent": "askme-repository-sync",
    "x-github-api-version": GITHUB_API_VERSION,
  });
  const token = input.token?.trim();
  if (token) headers.set("authorization", `Bearer ${token}`);

  const repositoryPath = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}`;
  const commitResponse = await fetchWithDeadline(
    fetcher,
    `${GITHUB_API}${repositoryPath}/commits/${encodeURIComponent(requestedRef)}`,
    { method: "GET", redirect: "error", headers },
    timeoutMs,
  );
  if (!commitResponse.ok) throw safeGitHubError(commitResponse.status, "ref");
  let commitPayload: unknown;
  try {
    commitPayload = await commitResponse.json();
  } catch {
    throw new AppError("GITHUB_REF_INVALID", "GitHub returned an invalid revision response.", 502);
  }
  const commitSha = commitPayload && typeof commitPayload === "object" && "sha" in commitPayload && typeof commitPayload.sha === "string"
    ? commitPayload.sha.toLowerCase()
    : "";
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new AppError("GITHUB_REF_INVALID", "GitHub did not resolve the requested ref to a full commit SHA.", 502);
  }

  const archiveResponse = await fetchWithDeadline(
    fetcher,
    `${GITHUB_API}${repositoryPath}/zipball/${commitSha}`,
    { method: "GET", redirect: "manual", headers: new Headers({ ...Object.fromEntries(headers), accept: "application/vnd.github+json" }) },
    timeoutMs,
  );
  let downloadResponse = archiveResponse;
  if ([301, 302, 303, 307, 308].includes(archiveResponse.status)) {
    const location = archiveResponse.headers.get("location");
    let downloadUrl: URL;
    try {
      downloadUrl = new URL(location ?? "");
    } catch {
      throw new AppError("GITHUB_ARCHIVE_REDIRECT_INVALID", "GitHub returned an invalid archive redirect.", 502);
    }
    if (downloadUrl.protocol !== "https:" || downloadUrl.hostname !== "codeload.github.com" || downloadUrl.username || downloadUrl.password) {
      throw new AppError("GITHUB_ARCHIVE_REDIRECT_INVALID", "GitHub returned an invalid archive redirect.", 502);
    }
    downloadResponse = await fetchWithDeadline(
      fetcher,
      downloadUrl.toString(),
      { method: "GET", redirect: "error", headers: { accept: "application/zip,application/octet-stream" } },
      timeoutMs,
    );
  }
  if (!downloadResponse.ok) throw safeGitHubError(downloadResponse.status, "archive");
  const archive = await boundedBytes(downloadResponse, maxArchiveBytes);
  if (archive.byteLength === 0) throw new AppError("GITHUB_ARCHIVE_INVALID", "GitHub returned an empty repository archive.", 502);

  return {
    ...repository,
    requestedRef,
    commitSha,
    archive,
    archiveBytes: archive.byteLength,
    archiveChecksum: createHash("sha256").update(archive).digest("hex"),
  };
}
