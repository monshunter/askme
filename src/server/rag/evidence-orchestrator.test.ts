import { describe, expect, it, vi } from "vitest";

import { getRuntimeConfig } from "@/server/config";

import { buildEvidencePack, judgeEvidenceCoverage, rerankCandidates, runBoundedRetrieval } from "./evidence-orchestrator";
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

describe("judgeEvidenceCoverage", () => {
  it("does not infer a conflict from an unrelated negation across evidence families", () => {
    const plan = {
      ...analyzeDeterministicQuery("OneCat 项目的定位是什么？"),
      entities: ["OneCat"],
      mustTerms: ["OneCat"],
    };
    const project = candidate("e1", "f1", "OneCat 是声明式 HTTP 网关项目。");
    const boundary = candidate("e2", "f2", "OneCat 不是云资源供应平台，也不负责创建 Kubernetes 集群。");

    expect(judgeEvidenceCoverage(plan, [project, boundary], false).coverage).toBe("full");
  });

  it("returns none when low-relevance evidence does not support any required entity", () => {
    const plan = {
      ...analyzeDeterministicQuery("askme 项目呢？"),
      entities: ["askme"],
      mustTerms: ["askme", "项目"],
      shouldTerms: ["askme", "项目", "介绍", "用途", "功能"],
    };
    const unrelated = {
      ...candidate("e1", "f1", "OneCat 是一个用 Go 编写的声明式 HTTP 网关项目。"),
      rerankScore: 0.391,
      score: 0.391,
      routeRanks: { lexical: 1, vector: 5 },
    };
    const unrelatedNegative = {
      ...candidate("e2", "f2", "OneCat 是个人开源项目，但不是云资源供应平台。"),
      rerankScore: 0.374,
      score: 0.374,
      routeRanks: { lexical: 2, vector: 7 },
    };

    expect(judgeEvidenceCoverage(plan, [unrelated, unrelatedNegative], false)).toEqual({ coverage: "none", unsupportedAspects: ["askme"] });
  });

  it("keeps strongly reranked semantic evidence eligible without requiring literal entity text", () => {
    const plan = {
      ...analyzeDeterministicQuery("Askme 是什么？"),
      entities: ["Askme"],
      mustTerms: ["Askme"],
    };
    const semanticMatch = {
      ...candidate("e1", "f1", "这是一个帮助候选人管理职业资料并向面试官提供有引用回答的职业知识智能体。", { vector: 1 }),
      rerankScore: 0.91,
      score: 0.91,
    };

    expect(judgeEvidenceCoverage(plan, [semanticMatch], false).coverage).toBe("partial");
  });

  it("keeps a related multi-turn reference answerable when its resolved entity is supported", () => {
    const plan = analyzeDeterministicQuery("它解决了什么问题？", [
      { role: "user", content: "介绍一下 Askme 项目" },
      { role: "assistant", content: "Askme 是职业知识 Agent。" },
    ]);
    const related = {
      ...candidate("e1", "f1", "Askme 帮助候选人管理职业资料，并向面试官提供带 Citation 的授权回答。", { exact: 1, vector: 1 }),
      rerankScore: 0.93,
      score: 0.93,
    };

    expect(judgeEvidenceCoverage(plan, [related], false).coverage).toBe("partial");
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
