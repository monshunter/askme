import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

import { fetchGitHubRevision, parseGitHubRepositoryUrl, type GitHubFetch } from "./github-adapter";

describe("GitHub repository adapter", () => {
  it("accepts only canonical github.com repository URLs", () => {
    expect(parseGitHubRepositoryUrl("https://github.com/QuantumNous/new-api.git")).toEqual({
      owner: "QuantumNous",
      repository: "new-api",
      canonicalUrl: "https://github.com/QuantumNous/new-api",
      displayName: "QuantumNous/new-api",
    });
    expect(() => parseGitHubRepositoryUrl("https://git.example.test/org/repo")).toThrowError(expect.objectContaining({ code: "INVALID_REPOSITORY_URL" }) as Partial<AppError>);
    expect(() => parseGitHubRepositoryUrl("https://github.com/org/repo/tree/main")).toThrowError(expect.objectContaining({ code: "INVALID_REPOSITORY_URL" }) as Partial<AppError>);
  });

  it("resolves a full SHA then downloads that immutable archive without forwarding the Token", async () => {
    const token = "github-request-only-token-sentinel";
    const sha = "ccd535ef8e50cf6e5846a59278c40b7ff59d1b7d";
    const archive = new TextEncoder().encode("bounded archive bytes");
    const fetcher = vi.fn<GitHubFetch>(async (url, init) => {
      const authorization = new Headers(init?.headers).get("authorization");
      if (url.startsWith("https://api.github.com/")) {
        expect(authorization).toBe(`Bearer ${token}`);
        if (url.includes("/commits/")) return Response.json({ sha });
        return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/QuantumNous/new-api/legacy.zip/${sha}` } });
      }
      expect(url).toBe(`https://codeload.github.com/QuantumNous/new-api/legacy.zip/${sha}`);
      expect(authorization).toBeNull();
      return new Response(archive, { status: 200, headers: { "content-type": "application/zip", "content-length": String(archive.byteLength) } });
    });

    const result = await fetchGitHubRevision({ repositoryUrl: "https://github.com/QuantumNous/new-api", ref: "main", token }, { fetcher });

    expect(result).toMatchObject({
      canonicalUrl: "https://github.com/QuantumNous/new-api",
      displayName: "QuantumNous/new-api",
      commitSha: sha,
      archiveBytes: archive.byteLength,
      archiveChecksum: createHash("sha256").update(archive).digest("hex"),
    });
    expect(result.archive).toEqual(archive);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("rejects non-full commit responses and archive redirects outside codeload.github.com", async () => {
    const invalidShaFetcher = vi.fn<GitHubFetch>().mockResolvedValue(Response.json({ sha: "main" }));
    await expect(fetchGitHubRevision({ repositoryUrl: "https://github.com/org/repo", ref: "main" }, { fetcher: invalidShaFetcher })).rejects.toMatchObject({ code: "GITHUB_REF_INVALID" } satisfies Partial<AppError>);

    const externalRedirect = vi.fn<GitHubFetch>(async (url) => url.includes("/commits/")
      ? Response.json({ sha: "1111111111111111111111111111111111111111" })
      : new Response(null, { status: 302, headers: { location: "https://evil.example.test/archive.zip" } }));
    await expect(fetchGitHubRevision({ repositoryUrl: "https://github.com/org/repo", ref: "main" }, { fetcher: externalRedirect })).rejects.toMatchObject({ code: "GITHUB_ARCHIVE_REDIRECT_INVALID" } satisfies Partial<AppError>);
  });

  it("bounds archive bytes and never exposes provider bodies or Tokens in safe errors", async () => {
    const token = "never-leak-token-sentinel";
    const sha = "1111111111111111111111111111111111111111";
    const fetcher = vi.fn<GitHubFetch>(async (url) => {
      if (url.includes("/commits/")) return Response.json({ sha });
      if (url.startsWith("https://api.github.com/")) return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/org/repo/legacy.zip/${sha}` } });
      return new Response("provider body with never-leak-token-sentinel", { status: 200, headers: { "content-length": "4096" } });
    });

    let caught: unknown;
    try {
      await fetchGitHubRevision({ repositoryUrl: "https://github.com/org/repo", ref: sha, token }, { fetcher, maxArchiveBytes: 32 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "REPOSITORY_ARCHIVE_TOO_LARGE" } satisfies Partial<AppError>);
    expect(JSON.stringify(caught)).not.toContain(token);
    expect(JSON.stringify(caught)).not.toContain("provider body");
  });
});
