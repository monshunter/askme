import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { getCandidateActiveRepositoryKnowledge } from "./dossier-review-service";

describe("active Repository knowledge detail", () => {
  it("follows the active approved projection instead of returning the latest pending Dossier", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        repositoryId: "22222222-2222-4222-8222-222222222222",
        displayName: "monshunter/copybook",
        visibility: "public_preview",
        dossierId: "33333333-3333-4333-8333-333333333333",
        revisionId: "44444444-4444-4444-8444-444444444444",
        commitSha: "a".repeat(40),
        generatedVersion: 4,
        title: "Copybook Generator — Repository Wiki",
        summary: "Approved repository knowledge",
        coverage: { examinedFileCount: 34, eligibleFileCount: 165 },
        outdatedReason: null,
        updatedAt: new Date("2026-08-14T00:00:00Z"),
        projectionId: "55555555-5555-4555-8555-555555555555",
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: "66666666-6666-4666-8666-666666666666",
        path: "overview.md",
        title: "Overview",
        generatedMarkdown: "# Overview\n\n## Summary\nApproved knowledge [S1]",
        sortOrder: 0,
        editedMarkdown: null,
        citations: [{ marker: "S1", path: "README.md", lineStart: 1, lineEnd: 4, contentHash: "b".repeat(64), rank: 1 }],
      }] });

    const result = await getCandidateActiveRepositoryKnowledge(
      { query } as unknown as Pool,
      "owner",
      "22222222-2222-4222-8222-222222222222",
    );

    expect(result).toMatchObject({
      sourceKind: "repository_wiki",
      repository: { displayName: "monshunter/copybook", visibility: "public_preview" },
      dossier: { generatedVersion: 4, pages: [{ path: "overview.md", title: "Overview" }] },
    });
    expect(String(query.mock.calls[0]?.[0])).toContain("repository.active_projection_id");
    expect(String(query.mock.calls[0]?.[0])).toContain("projection.state='approved'");
    expect(String(query.mock.calls[0]?.[0])).toContain("AND NOT EXISTS");
    expect(String(query.mock.calls[0]?.[0])).not.toContain("ORDER BY dossier.generated_version DESC");
  });

  it("returns not found when the Repository has no active approved knowledge", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });

    const result = getCandidateActiveRepositoryKnowledge(
      { query } as unknown as Pool,
      "owner",
      "22222222-2222-4222-8222-222222222222",
    );

    await expect(result).rejects.toMatchObject({ code: "REPOSITORY_KNOWLEDGE_NOT_FOUND", status: 404 });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
