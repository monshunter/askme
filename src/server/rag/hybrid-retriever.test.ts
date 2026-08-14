import { describe, expect, it, vi } from "vitest";

import { getRuntimeConfig } from "@/server/config";

import { fuseWeightedRrf, retrieveHybridEvidence, type RagRouteHit } from "./hybrid-retriever";
import { analyzeDeterministicQuery } from "./query-planner";

function hit(id: string, parentId: string, family: string): RagRouteHit {
  return {
    evidenceId: id,
    parentId,
    stableKey: id.padEnd(64, "a").slice(0, 64),
    sourceVersionId: "11111111-1111-4111-8111-111111111111",
    indexVersionId: "22222222-2222-4222-8222-222222222222",
    sourceKind: "material",
    sourceId: "33333333-3333-4333-8333-333333333333",
    repositoryId: null,
    sourceRevision: "revision",
    evidenceFamilyId: family,
    visibility: "citation_allowed",
    title: "Resume",
    path: null,
    commitSha: null,
    revisionId: null,
    sourceContentHash: null,
    structurePath: "Experience",
    content: `Evidence ${id}`,
    parentContent: `Parent ${parentId}`,
    tokenCount: 10,
    sourceRange: { lineStart: 1, lineEnd: 2 },
    contentChecksum: "f".repeat(64),
  };
}

describe("fuseWeightedRrf", () => {
  it("uses route ranks and configured weights, then caps children per parent deterministically", () => {
    const first = hit("e1", "p1", "family-1");
    const second = hit("e2", "p2", "family-2");
    const third = hit("e3", "p1", "family-1");
    const fourth = hit("e4", "p1", "family-1");
    const fused = fuseWeightedRrf({ exact: [first, second, third, fourth], lexical: [second, first], vector: [], structured: [] }, {
      exact: 1.5, lexical: 1, vector: 1, structured: 1.2, rrfK: 60, maxChildrenPerParent: 2,
    });

    expect(fused.map((candidate) => candidate.evidenceId)).toEqual(["e1", "e2", "e3"]);
    expect(fused[0]?.routeRanks).toEqual({ exact: 1, lexical: 2 });
    expect(fused.find((candidate) => candidate.evidenceId === "e4")).toBeUndefined();
  });
});

describe("retrieveHybridEvidence", () => {
  it("keeps exact, lexical, and structured retrieval when embedding fails", async () => {
    const row = hit("e1", "p1", "family-1");
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("rag-route:exact")) return Promise.resolve({ rows: [row] });
      if (sql.includes("rag-route:lexical")) return Promise.resolve({ rows: [row] });
      if (sql.includes("rag-route:structured")) return Promise.resolve({ rows: [] });
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const embeddingClient = { embed: vi.fn().mockRejectedValue(new Error("provider unavailable")) };

    const result = await retrieveHybridEvidence({ query } as never, "44444444-4444-4444-8444-444444444444", "candidate_preview", analyzeDeterministicQuery("富途控股职责"), getRuntimeConfig(), { embeddingClient });

    expect(result.candidates).toHaveLength(1);
    expect(result.routeCounts).toEqual({ exact: 1, lexical: 1, vector: 0, structured: 0 });
    expect(result.degradations).toContain("embedding_fallback");
    expect(embeddingClient.embed).toHaveBeenCalledOnce();
    const sql = query.mock.calls.map((call) => String(call[0])).join("\n");
    expect(sql).toContain('parent.token_count AS "tokenCount"');
    expect(sql).toContain('parent.source_range AS "sourceRange"');
  });
});
