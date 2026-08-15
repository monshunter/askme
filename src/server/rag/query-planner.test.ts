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
    expect(plan.entityMentions).toContainEqual({ text: "Askme", type: "project", source: "contextual" });
  });

  it("extracts a lowercase explicit project identity before provider planning", () => {
    const plan = analyzeDeterministicQuery("askme 项目的定位和核心功能是什么？");

    expect(plan.entityMentions).toContainEqual({ text: "askme", type: "project", source: "explicit" });
    expect(plan.entities).toContain("askme");
  });

  it("keeps a strict product identity when a Chinese predicate follows the category directly", () => {
    const plan = analyzeDeterministicQuery("NebulaCRM 产品解决了什么问题？");

    expect(plan.entityMentions).toContainEqual({ text: "NebulaCRM", type: "product", source: "explicit" });
  });

  it("treats an untyped CamelCase proper name as a strict identity candidate during provider fallback", () => {
    const plan = analyzeDeterministicQuery("MoonBase 怎么样？");

    expect(plan.entityMentions).toContainEqual({ text: "MoonBase", type: "project", source: "explicit" });
  });

  it("keeps all-uppercase technology-like terms soft without a type cue", () => {
    const plan = analyzeDeterministicQuery("RAG 怎么样？");

    expect(plan.entityMentions).toContainEqual({ text: "RAG", type: "other", source: "explicit" });
  });

  it("extracts the repository identity from a deterministic source-inspection question", () => {
    const plan = analyzeDeterministicQuery("copybook 的 `paginate` 函数如何处理剩余格子？");

    expect(plan.entityMentions).toContainEqual({ text: "copybook", type: "repository", source: "explicit" });
  });

  it("does not treat generic role, category, or demonstrative words as strict identities", () => {
    expect(analyzeDeterministicQuery("候选人有哪些项目？").entityMentions).toEqual([]);
    expect(analyzeDeterministicQuery("这个项目解决了什么问题？").entityMentions).toEqual([]);
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
        entityMentions: [
          { text: "富途控股", type: "organization", source: "explicit" },
          { text: "RAG", type: "technology", source: "explicit" },
        ],
        mustTerms: ["富途控股"],
        shouldTerms: ["RAG", "职责"],
        semanticQueries: ["富途控股的岗位职责", "RAG 工作成果"],
        desiredEvidenceTypes: ["material", "knowledge", "repository_document"],
      }),
      inputTokens: 20,
      outputTokens: 30,
    });

    const result = await planRagQuery({ question: "候选人在富途控股负责哪些 RAG 工作？", allowedEvidenceTypes: ["material", "knowledge", "repository_document"] }, { complete });

    expect(result.degradations).toEqual([]);
    expect(result.semanticQueries).toHaveLength(2);
    expect(result.desiredEvidenceTypes).toEqual(["material", "knowledge", "repository_document"]);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("does not let the provider rewrite away a deterministic explicit entity", async () => {
    const complete = vi.fn<AnswerClient["complete"]>().mockResolvedValue({
      content: JSON.stringify({
        standaloneQuery: "职业知识系统的定位",
        entityMentions: [],
        mustTerms: [],
        shouldTerms: ["职业知识"],
        semanticQueries: ["职业知识系统"],
        desiredEvidenceTypes: ["material"],
      }),
      inputTokens: 20,
      outputTokens: 30,
    });

    const result = await planRagQuery({ question: "askme 项目的定位是什么？", allowedEvidenceTypes: ["material"] }, { complete });

    expect(result.entityMentions).toContainEqual({ text: "askme", type: "project", source: "explicit" });
    expect(result.standaloneQuery).toContain("askme");
    expect(result.semanticQueries[0]).toContain("askme");
  });

  it("falls back to the deterministic plan when planner output is invalid", async () => {
    const complete = vi.fn<AnswerClient["complete"]>().mockResolvedValue({ content: '{"tenant":"other"}', inputTokens: 1, outputTokens: 1 });

    const result = await planRagQuery({ question: "富途控股的职责是什么？", allowedEvidenceTypes: ["material"] }, { complete });

    expect(result.degradations).toContain("planner_fallback");
    expect(result.desiredEvidenceTypes).toEqual(["material"]);
    expect(result.lexicalTerms).toContain("富途");
  });
});
