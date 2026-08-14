import { describe, expect, it, vi } from "vitest";

import { getRuntimeConfig } from "@/server/config";

import { buildEvidencePack, rerankCandidates, runBoundedRetrieval } from "./evidence-orchestrator";
import type { RetrievedRagEvidence } from "./hybrid-retriever";
import { analyzeDeterministicQuery } from "./query-planner";

function candidate(id: string, family: string, content: string, routeRanks: RetrievedRagEvidence["routeRanks"] = { exact: 1, lexical: 1 }): RetrievedRagEvidence {
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
    evidenceFamilyId: family,
    visibility: "citation_allowed",
    title: "Resume",
    path: null,
    commitSha: null,
    revisionId: null,
    sourceContentHash: null,
    structurePath: "Experience",
    content,
    parentContent: content,
    tokenCount: 10,
    sourceRange: { lineStart: 1, lineEnd: 2 },
    contentChecksum: "f".repeat(64),
    score: 0.02,
    rrfScore: 0.02,
    routeRanks,
  };
}

describe("rerankCandidates", () => {
  it("uses only valid provider indices and preserves request-local scores", async () => {
    const candidates = [candidate("e1", "f1", "one"), candidate("e2", "f2", "two")];
    const rerank = vi.fn().mockResolvedValue({ rankings: [{ index: 1, score: 0.9 }, { index: 0, score: 0.4 }], inputTokens: 8 });

    const result = await rerankCandidates("question", candidates, { rerank }, 8);

    expect(result.candidates.map((item) => item.evidenceId)).toEqual(["e2", "e1"]);
    expect(result.candidates[0]?.rerankScore).toBe(0.9);
    expect(result.degradations).toEqual([]);
  });

  it("falls back to RRF without changing the authorization set", async () => {
    const candidates = [candidate("e1", "f1", "one"), candidate("e2", "f2", "two")];
    const result = await rerankCandidates("question", candidates, { rerank: vi.fn().mockRejectedValue(new Error("down")) }, 8);

    expect(result.candidates.map((item) => item.evidenceId)).toEqual(["e1", "e2"]);
    expect(result.degradations).toEqual(["rerank_fallback"]);
  });
});

describe("buildEvidencePack", () => {
  it("counts independent families once and enforces the effective model budget", () => {
    const config = getRuntimeConfig();
    const plan = analyzeDeterministicQuery("富途控股职责");
    const result = buildEvidencePack([
      candidate("e1", "same-family", "富途控股负责 Hybrid RAG。"),
      candidate("e2", "same-family", "富途控股负责检索评测。"),
    ], plan, { ...config.rag.evidence, maxTokens: 20 }, 20_000, false);

    expect(result.actualTokens).toBeLessThanOrEqual(result.effectiveTokens);
    expect(result.independentFamilyCount).toBe(1);
    expect(result.coverage).toBe("full");
  });
});

describe("runBoundedRetrieval", () => {
  it("performs at most one targeted retry without changing the authorized retriever", async () => {
    const config = getRuntimeConfig();
    const initialPlan = analyzeDeterministicQuery("富途控股职责");
    const retrieve = vi.fn()
      .mockResolvedValueOnce({ candidates: [candidate("e1", "f1", "无关的通用介绍", { vector: 1 })], routeCounts: { exact: 0, lexical: 0, vector: 1, structured: 0 }, degradations: [] })
      .mockResolvedValueOnce({ candidates: [candidate("e2", "f2", "富途控股负责 Hybrid RAG 检索。")], routeCounts: { exact: 1, lexical: 1, vector: 1, structured: 0 }, degradations: [] });
    const rerank = { rerank: vi.fn().mockRejectedValue(new Error("not configured")) };

    const result = await runBoundedRetrieval({ initialPlan, config, retrieve, rerankClient: rerank });

    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(result.roundCount).toBe(2);
    expect(result.coverage).toBe("full");
    expect(result.degradations).toContain("rerank_fallback");
  });
});
