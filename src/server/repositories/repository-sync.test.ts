import { describe, expect, it, vi } from "vitest";

import type { GitHubFetch } from "./github-adapter";
import { synchronizeRepository, type RepositoryArtifactStore, type RepositoryRevisionStore } from "./repository-sync";

const sha = "ccd535ef8e50cf6e5846a59278c40b7ff59d1b7d";

describe("Repository synchronization", () => {
  it("passes request-only credentials only to GitHub and commits an immutable full-SHA revision", async () => {
    const token = "request-only-token-sentinel";
    const archive = new TextEncoder().encode("zip");
    const fetcher = vi.fn<GitHubFetch>(async (url, init) => {
      if (url.includes("/commits/")) return Response.json({ sha });
      if (url.startsWith("https://api.github.com/")) return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/org/repo/legacy.zip/${sha}` } });
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      return new Response(archive, { status: 200 });
    });
    const artifactStore: RepositoryArtifactStore = {
      store: vi.fn().mockResolvedValue({
        contentKey: "a".repeat(64), checksum: "a".repeat(64), manifestChecksum: "b".repeat(64), storagePath: "aa/a.tar.zst",
        compressedBytes: 2, extractedBytes: 3, fileCount: 1, filterFingerprint: "c".repeat(64), excludePatterns: [],
      }),
    };
    const revisionStore: RepositoryRevisionStore = { commit: vi.fn().mockResolvedValue({ repositoryId: "repo-id", revisionId: "revision-id", activeRevisionId: "old-active" }) };

    const result = await synchronizeRepository(
      "owner-id",
      { repositoryUrl: "https://github.com/org/repo", ref: "main", token, visibility: "private" },
      { fetcher, artifactStore, revisionStore },
    );

    expect(result).toMatchObject({ repositoryId: "repo-id", revisionId: "revision-id", commitSha: sha, activeRevisionId: "old-active" });
    expect(JSON.stringify(vi.mocked(artifactStore.store).mock.calls)).not.toContain(token);
    expect(JSON.stringify(vi.mocked(revisionStore.commit).mock.calls)).not.toContain(token);
    expect(vi.mocked(revisionStore.commit).mock.calls[0]?.[1]).toMatchObject({ commitSha: sha, requestedRef: "main", visibility: "private" });
  });

  it("does not enter the revision transaction when GitHub resolution fails", async () => {
    const fetcher = vi.fn<GitHubFetch>().mockResolvedValue(new Response("not found", { status: 404 }));
    const artifactStore: RepositoryArtifactStore = { store: vi.fn() };
    const revisionStore: RepositoryRevisionStore = { commit: vi.fn() };

    await expect(synchronizeRepository(
      "owner-id",
      { repositoryUrl: "https://github.com/org/repo", ref: "missing", visibility: "public_preview" },
      { fetcher, artifactStore, revisionStore },
    )).rejects.toMatchObject({ code: "GITHUB_ACCESS_DENIED" });

    expect(artifactStore.store).not.toHaveBeenCalled();
    expect(revisionStore.commit).not.toHaveBeenCalled();
  });
});
