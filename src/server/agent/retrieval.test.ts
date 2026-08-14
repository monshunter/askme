import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { searchEvidence } from "./retrieval";

describe("searchEvidence", () => {
  it("removes the same chunk position from duplicate uploads before filling the Evidence packet", async () => {
    const duplicate = {
      chunkId: "chunk-1",
      materialId: "material-1",
      contentChecksum: "same-content",
      materialTitle: "SPEC.md",
      materialKind: "file" as const,
      externalUrl: null,
      visibility: "agent_only" as const,
      position: 3,
      content: "MVP scope",
      score: 0.9,
    };
    const query = vi.fn().mockResolvedValue({ rows: [
      duplicate,
      { ...duplicate, chunkId: "chunk-2", materialId: "material-2" },
      { ...duplicate, chunkId: "chunk-3", position: 4, content: "MVP exclusions", score: 0.8 },
    ] });

    const evidence = await searchEvidence({ query } as unknown as Pool, "owner", "candidate_preview", { query: "MVP", limit: 8 });

    expect(evidence.map((item) => item.chunkId)).toEqual(["chunk-1", "chunk-3"]);
    expect(query.mock.calls[0]?.[1]?.[4]).toBe(32);
  });
});
