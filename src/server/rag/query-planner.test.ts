import { describe, expect, it, vi } from "vitest";

import type { AnswerClient } from "@/server/agent/answer-generator";

import { analyzeDeterministicQuery, planRagQuery } from "./query-planner";

describe("analyzeDeterministicQuery", () => {
  it("normalizes mixed-width text and produces bounded CJK lexemes instead of one Chinese sentence token", () => {
    const plan = analyzeDeterministicQuery("候选人在富途控股负责 Ｑｗｅｎ３．７ 和 RAG 的哪些工作？");

    expect(plan.normalizedQuestion).toBe("候选人在富途控股负责 Qwen3.7 和 RAG 的哪些工作?");
    expect(plan.lexicalTerms).toContain("富途");
    expect(plan.lexicalTerms).toContain("控股");
    expect(plan.lexicalTerms).toContain("qwen3");
    expect(plan.lexicalTerms).toContain("rag");
    expect(plan.lexicalTerms).not.toContain(plan.normalizedQuestion);
    expect(plan.semanticQueries).toEqual([plan.standaloneQuery]);
  });

  it("resolves a bounded conversational reference from the latest safe context", () => {
    const plan = analyzeDeterministicQuery("它解决了什么问题？", [
      { role: "user", content: "介绍一下 Askme 项目" },
      { role: "assistant", content: "Askme 是职业知识 Agent。" },
    ]);

    expect(plan.standaloneQuery).toContain("Askme");
    expect(plan.standaloneQuery).toContain("它解决了什么问题");
  });

  it("preserves every explicit compound-question aspect in the original order", () => {
    const plan = analyzeDeterministicQuery("先后在哪些公司工作？分别是什么时候？负责什么工作，取得哪些成就？");

    expect(plan.answerAspects).toEqual([
      { aspectId: "a1", label: "先后在哪些公司工作" },
      { aspectId: "a2", label: "分别是什么时候" },
      { aspectId: "a3", label: "负责什么工作" },
      { aspectId: "a4", label: "取得哪些成就" },
    ]);
  });
});

describe("planRagQuery", () => {
  it("accepts only the structured planner schema and caps semantic queries at two", async () => {
    const complete = vi.fn<AnswerClient["complete"]>().mockResolvedValue({
      content: JSON.stringify({
        standaloneQuery: "富途控股职责与 RAG 工作",
        entities: ["富途控股", "RAG"],
        mustTerms: ["富途控股"],
        shouldTerms: ["RAG", "职责"],
        semanticQueries: ["富途控股的岗位职责", "RAG 工作成果"],
        desiredEvidenceTypes: ["material", "knowledge", "repository_document"],
      }),
      inputTokens: 20,
      outputTokens: 30,
    });

    const result = await planRagQuery({ question: "候选人在富途做过什么？", allowedEvidenceTypes: ["material", "knowledge", "repository_document"] }, { complete });

    expect(result.degradations).toEqual([]);
    expect(result.semanticQueries).toHaveLength(2);
    expect(result.desiredEvidenceTypes).toEqual(["material", "knowledge", "repository_document"]);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("falls back to the deterministic plan when planner output is invalid", async () => {
    const complete = vi.fn<AnswerClient["complete"]>().mockResolvedValue({ content: '{"tenant":"other"}', inputTokens: 1, outputTokens: 1 });

    const result = await planRagQuery({ question: "富途控股的职责是什么？", allowedEvidenceTypes: ["material"] }, { complete });

    expect(result.degradations).toContain("planner_fallback");
    expect(result.desiredEvidenceTypes).toEqual(["material"]);
    expect(result.lexicalTerms).toContain("富途");
  });
});
