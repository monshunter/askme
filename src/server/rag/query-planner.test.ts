import { describe, expect, it, vi } from "vitest";

import type { AnswerClient } from "@/server/agent/answer-generator";

import { analyzeDeterministicQuery, planRagQuery, ragAdjudicationReason } from "./query-planner";

describe("analyzeDeterministicQuery", () => {
  it("normalizes mixed-width text and produces bounded CJK lexemes instead of one Chinese sentence token", () => {
    const plan = analyzeDeterministicQuery("候选人在富途控股负责 Ｑｗｅｎ３．７ 和 RAG 的哪些工作？");

    expect(plan.normalizedQuestion).toBe("候选人在富途控股负责 Qwen3.7 和 RAG 的哪些工作?");
    expect(plan.lexicalTerms).toContain("富途");
    expect(plan.lexicalTerms).toContain("控股");
    expect(plan.lexicalTerms).toContain("qwen3");
    expect(plan.lexicalTerms).toContain("rag");
    expect(plan.lexicalTerms).not.toContain(plan.normalizedQuestion);
    expect(plan.semanticQueries).toHaveLength(1);
    expect(plan.semanticQueries[0]).toContain(plan.standaloneQuery);
  });

  it("resolves a bounded conversational reference from the latest safe context", () => {
    const plan = analyzeDeterministicQuery("它解决了什么问题？", [
      { role: "user", content: "介绍一下 Askme 项目" },
      { role: "assistant", content: "Askme 是职业知识 Agent。" },
    ]);

    expect(plan.standaloneQuery).not.toContain("Askme");
    expect(plan.standaloneQuery).toContain("它解决了什么问题");
    expect(plan.entityMentions).toEqual([]);
    expect(plan.queryMode).toBe("clarify");
  });

  it("models a self employment question as discovery with a time constraint and requested fields", () => {
    const plan = analyzeDeterministicQuery("2022年到2024年，你在哪家公司任职，担任什么职务，负责什么工作内容？");

    expect(plan).toMatchObject({
      intent: "employment_history",
      subject: "profile_owner",
      queryMode: "discovery",
      knowledgeScope: "employment",
      constraints: { timeRange: { start: "2022-01", end: "2024-12" } },
      requestedFields: ["company", "job_title", "responsibilities"],
    });
    expect(plan.entityMentions).toEqual([]);
    expect(plan.answerAspects).toEqual([
      { aspectId: "a1", label: "任职公司" },
      { aspectId: "a2", label: "职务" },
      { aspectId: "a3", label: "工作内容" },
    ]);
  });

  it("extracts a lowercase explicit project identity before provider planning", () => {
    const plan = analyzeDeterministicQuery("askme 项目的定位和核心功能是什么？");

    expect(plan.entityMentions).toContainEqual({ text: "askme", type: "project", source: "explicit", role: "required" });
    expect(plan.queryMode).toBe("focused");
    expect(plan.requestedFields).toEqual(["positioning", "functions"]);
    expect(plan.entities).toContain("askme");
  });

  it("keeps a strict product identity when a Chinese predicate follows the category directly", () => {
    const plan = analyzeDeterministicQuery("NebulaCRM 产品解决了什么问题？");

    expect(plan.entityMentions).toContainEqual({ text: "NebulaCRM", type: "product", source: "explicit", role: "required" });
  });

  it("treats an untyped CamelCase proper name as a strict identity candidate during provider fallback", () => {
    const plan = analyzeDeterministicQuery("MoonBase 怎么样？");

    expect(plan.entityMentions).toContainEqual({ text: "MoonBase", type: "project", source: "explicit", role: "required" });
  });

  it("does not drop a proper name merely because it contains an English question word", () => {
    const plan = analyzeDeterministicQuery("Showcase 项目的定位是什么？");

    expect(plan.entityMentions).toContainEqual({ text: "Showcase", type: "project", source: "explicit", role: "required" });
  });

  it("parses month-precision ranges separated by a plain hyphen", () => {
    const plan = analyzeDeterministicQuery("2022年4月-2024年10月，你在哪家公司任职？");

    expect(plan.constraints.timeRange).toEqual({ start: "2022-04", end: "2024-10" });
  });

  it("keeps all-uppercase technology-like terms soft without a type cue", () => {
    const plan = analyzeDeterministicQuery("RAG 怎么样？");

    expect(plan.entityMentions).toContainEqual({ text: "RAG", type: "other", source: "explicit", role: "context" });
  });

  it("extracts the repository identity from a deterministic source-inspection question", () => {
    const plan = analyzeDeterministicQuery("copybook 的 `paginate` 函数如何处理剩余格子？");

    expect(plan.entityMentions).toContainEqual({ text: "copybook", type: "repository", source: "explicit", role: "required" });
  });

  it("does not treat generic role, category, or demonstrative words as strict identities", () => {
    expect(analyzeDeterministicQuery("候选人有哪些项目？").entityMentions).toEqual([]);
    expect(analyzeDeterministicQuery("这个项目解决了什么问题？").entityMentions).toEqual([]);
  });

  it("turns only requested fields into answer aspects in the original order", () => {
    const plan = analyzeDeterministicQuery("先后在哪些公司工作？分别是什么时候？负责什么工作，取得哪些成就？");

    expect(plan.answerAspects).toEqual([
      { aspectId: "a1", label: "任职公司" },
      { aspectId: "a2", label: "任职时间" },
      { aspectId: "a3", label: "工作内容" },
      { aspectId: "a4", label: "工作成果" },
    ]);
  });

  it("splits a self introduction into multi-dimensional aspects so the answer renders in sections", () => {
    const plan = analyzeDeterministicQuery("介绍一下你自己");

    expect(plan.answerAspects).toEqual([
      { aspectId: "a1", label: "概述" },
      { aspectId: "a2", label: "技能" },
      { aspectId: "a3", label: "教育经历" },
      { aspectId: "a4", label: "项目" },
      { aspectId: "a5", label: "定位" },
    ]);
  });

  it("splits an English self introduction into English-labeled aspects", () => {
    const plan = analyzeDeterministicQuery("Please introduce yourself");

    expect(plan.answerAspects.map((aspect) => aspect.label)).toEqual(["summary", "skills", "education", "projects", "positioning"]);
  });

  it("keeps a single overview aspect for a fieldless non-introduction question", () => {
    const plan = analyzeDeterministicQuery("你平时怎么学习的？");

    expect(plan.answerAspects).toEqual([{ aspectId: "a1", label: "概述" }]);
  });

  it("does not expand when the question already names a concrete field", () => {
    const plan = analyzeDeterministicQuery("你做过哪些项目？");

    expect(plan.answerAspects).toEqual([{ aspectId: "a1", label: "项目" }]);
  });

  it("keeps an incidental named project as context in a discovery question", () => {
    const plan = analyzeDeterministicQuery("看过 Askme 后，我还做过哪些项目？");

    expect(plan.queryMode).toBe("discovery");
    expect(plan.requestedFields).toEqual(["project_name"]);
    expect(plan.entityMentions).toContainEqual({ text: "Askme", type: "other", source: "explicit", role: "context" });
  });

  it("keeps every named target required in a comparative multi-entity question", () => {
    const plan = analyzeDeterministicQuery("Askme 和 MoonBase 分别解决了什么问题？");

    expect(plan.entityMentions).toContainEqual({ text: "Askme", type: "other", source: "explicit", role: "required" });
    expect(plan.entityMentions).toContainEqual({ text: "MoonBase", type: "project", source: "explicit", role: "required" });
  });
});

describe("planRagQuery", () => {
  it("keeps the newest bounded conversation messages when the total context cap is reached", async () => {
    const complete = vi.fn<AnswerClient["complete"]>().mockResolvedValue({
      content: JSON.stringify({
        intent: "career_summary", subject: "profile_owner", queryMode: "discovery", knowledgeScope: "general",
        standaloneQuery: "候选人的职业概述", entityMentions: [], constraints: { timeRange: null }, requestedFields: ["summary"],
        confidence: 0.9, ambiguities: [], mustTerms: [], shouldTerms: ["职业概述"], semanticQueries: ["候选人的职业概述"],
        desiredEvidenceTypes: ["material"],
      }), inputTokens: 20, outputTokens: 30,
    });
    const conversation = Array.from({ length: 6 }, (_, index) => {
      const marker = index === 0 ? "OLDEST" : index === 5 ? "LATEST" : `M${index}`;
      return {
        role: index % 2 === 0 ? "user" as const : "assistant" as const,
        content: `${marker}${"x".repeat(1_200 - marker.length)}`,
      };
    });

    await planRagQuery({ question: "请概述我的职业经历", conversation, allowedEvidenceTypes: ["material"] }, { complete });

    const payload = JSON.parse(String(complete.mock.calls[0]?.[0]?.[1]?.content)) as { conversation: Array<{ content: string }> };
    expect(payload.conversation.some((message) => message.content.includes("LATEST"))).toBe(true);
    expect(payload.conversation.some((message) => message.content.includes("OLDEST"))).toBe(false);
    expect(payload.conversation.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(6_000);
  });

  it("accepts only the structured planner schema and caps semantic queries at two", async () => {
    const complete = vi.fn<AnswerClient["complete"]>().mockResolvedValue({
      content: JSON.stringify({
        intent: "employment_history",
        subject: "profile_owner",
        queryMode: "focused",
        knowledgeScope: "employment",
        standaloneQuery: "富途控股职责与 RAG 工作",
        entityMentions: [
          { text: "富途控股", type: "organization", source: "explicit", role: "required" },
          { text: "RAG", type: "technology", source: "explicit", role: "context" },
        ],
        constraints: { timeRange: null },
        requestedFields: ["responsibilities"],
        confidence: 0.95,
        ambiguities: [],
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
        intent: "entity_detail",
        subject: "required_entity",
        queryMode: "focused",
        knowledgeScope: "project",
        standaloneQuery: "职业知识系统的定位",
        entityMentions: [],
        constraints: { timeRange: null },
        requestedFields: ["positioning"],
        confidence: 0.95,
        ambiguities: [],
        mustTerms: [],
        shouldTerms: ["职业知识"],
        semanticQueries: ["职业知识系统"],
        desiredEvidenceTypes: ["material"],
      }),
      inputTokens: 20,
      outputTokens: 30,
    });

    const result = await planRagQuery({ question: "askme 项目的定位是什么？", allowedEvidenceTypes: ["material"] }, { complete });

    expect(result.entityMentions).toContainEqual({ text: "askme", type: "project", source: "explicit", role: "required" });
    expect(result.standaloneQuery).toContain("askme");
    expect(result.semanticQueries[0]).toContain("askme");
  });

  it("does not let the provider narrow away Host-required evidence types", async () => {
    const complete = vi.fn<AnswerClient["complete"]>().mockResolvedValue({
      content: JSON.stringify({
        intent: "employment_history", subject: "profile_owner", queryMode: "discovery", knowledgeScope: "employment",
        standaloneQuery: "候选人的任职公司", entityMentions: [], constraints: { timeRange: null }, requestedFields: ["company"],
        confidence: 0.95, ambiguities: [], mustTerms: [], shouldTerms: ["任职公司"], semanticQueries: ["候选人的任职公司"],
        desiredEvidenceTypes: ["repository_document"],
      }), inputTokens: 20, outputTokens: 30,
    });

    const result = await planRagQuery({
      question: "你在哪家公司任职？",
      allowedEvidenceTypes: ["material", "knowledge", "repository_document"],
    }, { complete });

    expect(result.desiredEvidenceTypes).toEqual(["material", "knowledge", "repository_document"]);
  });

  it("falls back to the deterministic plan when planner output is invalid", async () => {
    const complete = vi.fn<AnswerClient["complete"]>().mockResolvedValue({ content: '{"tenant":"other"}', inputTokens: 1, outputTokens: 1 });

    const result = await planRagQuery({ question: "富途控股的职责是什么？", allowedEvidenceTypes: ["material"] }, { complete });

    expect(result.degradations).toContain("planner_fallback");
    expect(result.desiredEvidenceTypes).toEqual(["material"]);
    expect(result.lexicalTerms).toContain("富途");
  });

  it("uses bounded target grammar only as the catalog-aware provider fallback", async () => {
    const complete = vi.fn<AnswerClient["complete"]>().mockResolvedValue({ content: '{"invalid":true}', inputTokens: 1, outputTokens: 1 });
    const catalogCandidate = { text: "Askme", type: "project" as const, source: "explicit" as const, role: "context" as const };

    const target = await planRagQuery({
      question: "Askme 怎么样？", allowedEvidenceTypes: ["material"], catalogCandidates: [catalogCandidate],
    }, { complete });
    const incidental = await planRagQuery({
      question: "看过 Askme 后，我还做过哪些项目？", allowedEvidenceTypes: ["material"], catalogCandidates: [catalogCandidate],
    }, { complete });

    expect(target.entityMentions).toContainEqual({ ...catalogCandidate, role: "required" });
    expect(target.queryMode).toBe("focused");
    expect(incidental.entityMentions).toContainEqual(catalogCandidate);
    expect(incidental.queryMode).toBe("discovery");
  });

  it("rejects an LLM attempt to turn an interrogative phrase into a required entity", async () => {
    const complete = vi.fn<AnswerClient["complete"]>().mockResolvedValue({
      content: JSON.stringify({
        intent: "employment_history",
        subject: "profile_owner",
        queryMode: "focused",
        knowledgeScope: "employment",
        standaloneQuery: "2022 到 2024 你在哪家公司任职",
        entityMentions: [{ text: "你在哪家", type: "organization", source: "explicit", role: "required" }],
        constraints: { timeRange: { start: "2022-01", end: "2024-12" } },
        requestedFields: ["company"],
        confidence: 0.99,
        ambiguities: [],
        mustTerms: [],
        shouldTerms: ["任职公司"],
        semanticQueries: ["2022 到 2024 的任职公司"],
        desiredEvidenceTypes: ["material"],
      }),
      inputTokens: 20,
      outputTokens: 30,
    });

    const result = await planRagQuery({
      question: "2022 到 2024 年，你在哪家公司任职？",
      allowedEvidenceTypes: ["material"],
    }, { complete });

    expect(result.queryMode).toBe("discovery");
    expect(result.entityMentions).toEqual([]);
    expect(result.requestedFields).toEqual(["company"]);
  });
});

describe("ragAdjudicationReason", () => {
  it("requests at most one second semantic pass for a hard-stop", () => {
    const plan = analyzeDeterministicQuery("MoonBase 怎么样？");

    expect(ragAdjudicationReason({ plan, stopBeforeRetrieval: true })).toBe("entity_hard_stop");
    expect(ragAdjudicationReason({
      plan: { ...plan, adjudication: { applied: true, reasonCode: "entity_hard_stop" } },
      stopBeforeRetrieval: true,
    })).toBeNull();
  });
});
