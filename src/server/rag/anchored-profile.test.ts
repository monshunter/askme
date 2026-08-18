import { describe, expect, it, vi } from "vitest";

import { getRuntimeConfig } from "@/server/config";

import { loadAnchoredProfileEvidence } from "./anchored-profile";

const ownerId = "66666666-6666-4666-8666-666666666666";

function chunkRow(evidenceId: string, parentId: string, parentContent: string) {
  return {
    evidenceId,
    parentId,
    stableKey: "a".repeat(64),
    sourceVersionId: "33333333-3333-4333-8333-333333333333",
    indexVersionId: "44444444-4444-4444-8444-444444444444",
    sourceKind: "material",
    sourceId: "55555555-5555-4555-8555-555555555555",
    repositoryId: null,
    sourceRevision: "revision",
    evidenceFamilyId: "f".repeat(64),
    visibility: "public_preview",
    title: "02-简历.md",
    path: null,
    commitSha: null,
    revisionId: null,
    sourceContentHash: null,
    structurePath: "Overview",
    content: parentContent,
    parentContent,
    tokenCount: 10,
    sourceRange: { lineStart: 1, lineEnd: 2 },
    contentChecksum: "f".repeat(64),
  };
}

describe("loadAnchoredProfileEvidence", () => {
  it("returns one item per parent in document order", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [
      chunkRow("c1", "p1", "## 职业概述 第一段"),
      chunkRow("c2", "p1", "## 职业概述 第一段"),
      chunkRow("c3", "p2", "## 职业概述 第二段"),
    ] });
    const result = await loadAnchoredProfileEvidence({ query } as never, ownerId, "candidate_preview", getRuntimeConfig());
    expect(result.map((item) => item.evidenceId)).toEqual(["c1", "c3"]);
    expect(result[0]!.score).toBe(1);
    expect(result[0]!.routeRanks).toEqual({});
  });

  it("caps later chunks at the profile allowance", async () => {
    const config = {
      ...getRuntimeConfig(),
      rag: { ...getRuntimeConfig().rag, evidence: { ...getRuntimeConfig().rag.evidence, profileMaxChars: 520 } },
    };
    const query = vi.fn().mockResolvedValue({ rows: [
      chunkRow("c1", "p1", "x".repeat(500)),
      chunkRow("c2", "p2", "y".repeat(20)), // 500 + 20 fits the allowance
      chunkRow("c3", "p3", "z".repeat(20)), // 520 + 20 would exceed, cut off
    ] });
    const result = await loadAnchoredProfileEvidence({ query } as never, ownerId, "candidate_preview", config);
    expect(result.map((item) => item.evidenceId)).toEqual(["c1", "c2"]);
  });

  it("always includes the first chunk even when it exceeds the allowance", async () => {
    const config = {
      ...getRuntimeConfig(),
      rag: { ...getRuntimeConfig().rag, evidence: { ...getRuntimeConfig().rag.evidence, profileMaxChars: 20 } },
    };
    const query = vi.fn().mockResolvedValue({ rows: [
      chunkRow("c1", "p1", "x".repeat(500)),
      chunkRow("c2", "p2", "y".repeat(10)),
    ] });
    const result = await loadAnchoredProfileEvidence({ query } as never, ownerId, "candidate_preview", config);
    expect(result.map((item) => item.evidenceId)).toEqual(["c1"]);
  });

  it("returns no anchored evidence when no profile is pinned or nothing is indexed", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const result = await loadAnchoredProfileEvidence({ query } as never, ownerId, "candidate_preview", getRuntimeConfig());
    expect(result).toEqual([]);
    expect(query).toHaveBeenCalledOnce();
  });
});
