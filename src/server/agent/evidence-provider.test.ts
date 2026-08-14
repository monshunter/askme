import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { retrieveUnifiedEvidence } from "./evidence-provider";

describe("retrieveUnifiedEvidence", () => {
  it("combines document evidence with one approved Wiki section and its referenced source Citations", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        chunkId: "chunk", materialId: "material", materialTitle: "Resume", materialKind: "file", externalUrl: null,
        visibility: "agent_only", position: 0, content: "Career evidence", score: 0.8,
      }] })
      .mockResolvedValueOnce({ rows: [
        { repositoryWikiPageId: "page", repositoryId: "repo", repositoryTitle: "Askme", wikiPagePath: "architecture.md", wikiPageTitle: "Architecture", revisionId: "revision", commitSha: "a".repeat(40), visibility: "agent_only", markdown: "# Architecture\n\n## Isolated runner\nUses an isolated runner. [S1] [S2]", score: 0.9, marker: "S1", citationRank: 1, path: "src/runner.ts", lineStart: 1, lineEnd: 4, contentHash: "b".repeat(64) },
        { repositoryWikiPageId: "page", repositoryId: "repo", repositoryTitle: "Askme", wikiPagePath: "architecture.md", wikiPageTitle: "Architecture", revisionId: "revision", commitSha: "a".repeat(40), visibility: "agent_only", markdown: "# Architecture\n\n## Isolated runner\nUses an isolated runner. [S1] [S2]", score: 0.9, marker: "S2", citationRank: 2, path: "src/sandbox.ts", lineStart: 8, lineEnd: 12, contentHash: "c".repeat(64) },
      ] });

    const result = await retrieveUnifiedEvidence({ query } as unknown as Pool, "owner", "candidate_preview", { query: "isolated runner", limit: 8 });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ repositoryWikiPageId: "page", repositoryId: "repo", sectionHeading: "Isolated runner", content: expect.stringContaining("Uses an isolated runner") });
    expect(result[0]).toHaveProperty("sourceCitations", [
      { marker: "S1", path: "src/runner.ts", lineStart: 1, lineEnd: 4, contentHash: "b".repeat(64) },
      { marker: "S2", path: "src/sandbox.ts", lineStart: 8, lineEnd: 12, contentHash: "c".repeat(64) },
    ]);
    expect(String(query.mock.calls[1]?.[0])).toContain("repository.active_projection_id");
    expect(String(query.mock.calls[1]?.[0])).toContain("projection.state='approved'");
  });

  it("uses only public Repository visibilities for public evidence", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await retrieveUnifiedEvidence({ query } as unknown as Pool, "owner", "public_answer", { query: "Askme", limit: 8 });
    expect(query.mock.calls[1]?.[1]?.[1]).toEqual(["citation_allowed", "public_preview"]);
  });

  it("uses a Repository name only to locate the repository and does not match unrelated section identifiers", async () => {
    const markdown = [
      "# Copybook Generator",
      "",
      "## Summary",
      "A browser app that generates printable Chinese and English copybook sheets and PDF exports. [S1] [S2]",
      "",
      "## Application entry and providers",
      "The entry renders CopybookPreview inside App providers. [S3] [S4]",
    ].join("\n");
    const base = { repositoryWikiPageId: "page", repositoryId: "repo", repositoryTitle: "monshunter/copybook", wikiPagePath: "overview.md", wikiPageTitle: "Overview", revisionId: "revision", commitSha: "a".repeat(40), visibility: "public_preview", markdown, score: 0.9 };
    const architecture = { ...base, repositoryWikiPageId: "architecture", wikiPagePath: "architecture.md", wikiPageTitle: "Architecture", markdown: "# Architecture\n\n## Rendering pipeline\nLayout, pagination, and PDF rendering. [S6]" };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [
        { ...base, marker: "S1", citationRank: 1, path: "README.md", lineStart: 1, lineEnd: 100, contentHash: "b".repeat(64) },
        { ...base, marker: "S2", citationRank: 2, path: "package.json", lineStart: 1, lineEnd: 42, contentHash: "c".repeat(64) },
        { ...base, marker: "S3", citationRank: 3, path: "src/main.tsx", lineStart: 1, lineEnd: 16, contentHash: "d".repeat(64) },
        { ...base, marker: "S4", citationRank: 4, path: "src/App.tsx", lineStart: 1, lineEnd: 15, contentHash: "e".repeat(64) },
        { ...architecture, marker: "S6", citationRank: 6, path: "src/lib/layout.ts", lineStart: 1, lineEnd: 200, contentHash: "f".repeat(64) },
      ] });

    const result = await retrieveUnifiedEvidence({ query } as unknown as Pool, "owner", "public_answer", { query: "copybook 是一个什么样的项目？", limit: 8 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sectionHeading: "Summary" });
    expect(result[0]).toHaveProperty("sourceCitations", [
      expect.objectContaining({ marker: "S1", path: "README.md" }),
      expect.objectContaining({ marker: "S2", path: "package.json" }),
    ]);
    expect(String(query.mock.calls[1]?.[0])).toContain("repository.display_name");
  });
});
