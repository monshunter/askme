import { describe, expect, it } from "vitest";

import type { RetrievedRagEvidence } from "./hybrid-retriever";
import { annotateTemporalEvidence, extractEvidenceMonthRanges } from "./temporal-evidence";

function evidence(id: string, parentContent: string): RetrievedRagEvidence {
  return {
    evidenceId: id,
    parentId: `parent-${id}`,
    stableKey: id.padEnd(64, "a").slice(0, 64),
    sourceVersionId: "11111111-1111-4111-8111-111111111111",
    indexVersionId: "22222222-2222-4222-8222-222222222222",
    sourceKind: "material",
    sourceId: "33333333-3333-4333-8333-333333333333",
    repositoryId: null,
    sourceRevision: "revision",
    evidenceFamilyId: `family-${id}`,
    visibility: "citation_allowed",
    title: "Resume",
    path: null,
    commitSha: null,
    revisionId: null,
    sourceContentHash: null,
    structurePath: "Experience",
    content: parentContent,
    parentContent,
    tokenCount: 10,
    sourceRange: { lineStart: 1 },
    contentChecksum: "f".repeat(64),
    score: 1,
    rrfScore: 1,
    routeRanks: { exact: 1 },
  };
}

describe("temporal evidence", () => {
  it("extracts bounded and present ranges with month precision", () => {
    expect(extractEvidenceMonthRanges("A：2021.03 - 2022.06；B：2024年7月至今", "2026-08")).toEqual([
      { start: "2021-03", end: "2022-06" },
      { start: "2024-07", end: "2026-08" },
    ]);
  });

  it("uses inclusive interval overlap and keeps undated evidence unknown", () => {
    const result = annotateTemporalEvidence([
      evidence("overlap", "任职时间：2021年12月 - 2022年1月"),
      evidence("outside", "任职时间：2025年1月 - 2026年1月"),
      evidence("unknown", "负责知识库与 Agent 开发"),
    ], { start: "2022-01", end: "2024-12" }, "2026-08");

    expect(result.map((item) => item.status)).toEqual(["overlap", "outside", "unknown"]);
  });
});
