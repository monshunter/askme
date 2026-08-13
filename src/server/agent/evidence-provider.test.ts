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
});
