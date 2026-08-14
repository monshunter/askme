import { describe, expect, it, vi } from "vitest";

import type { AnswerClient } from "@/server/agent/answer-generator";

import type { RetrievedRagEvidence } from "./hybrid-retriever";
import { generateVerifiedRagAnswer, persistRagAnswerCitations } from "./rag-answer";

function evidence(id: string, content: string): RetrievedRagEvidence {
  return {
    evidenceId: id,
    parentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    stableKey: "a".repeat(64),
    sourceVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    indexVersionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    sourceKind: "material",
    sourceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    repositoryId: null,
    sourceRevision: "revision",
    evidenceFamilyId: "e".repeat(64),
    visibility: "citation_allowed",
    title: "Resume",
    path: null,
    commitSha: null,
    revisionId: null,
    sourceContentHash: null,
    structurePath: "Experience",
    content,
    parentContent: content,
    tokenCount: 12,
    sourceRange: { lineStart: 2, lineEnd: 4 },
    contentChecksum: "f".repeat(64),
    score: 0.9,
    rrfScore: 0.03,
    routeRanks: { exact: 1, lexical: 1 },
  };
}

describe("generateVerifiedRagAnswer", () => {
  it("drops unsupported claims, narrows partial claims, and renders only verified citations", async () => {
    const first = evidence("11111111-1111-4111-8111-111111111111", "候选人在富途负责 Hybrid RAG 检索。");
    const second = evidence("22222222-2222-4222-8222-222222222222", "候选人参与了评测。");
    const generator = vi.fn<AnswerClient["complete"]>().mockResolvedValue({
      content: JSON.stringify({
        coverage: "full",
        claims: [
          { claimId: "c1", aspectId: "a1", text: "候选人在富途负责 Hybrid RAG 检索和全部平台架构。", evidenceIds: [first.evidenceId] },
          { claimId: "c2", aspectId: "a1", text: "候选人创造了不存在的业绩。", evidenceIds: [second.evidenceId] },
        ],
        unsupportedAspectIds: [],
      }),
      inputTokens: 40,
      outputTokens: 20,
    });
    const verifier = vi.fn<AnswerClient["complete"]>()
      .mockResolvedValueOnce({ content: JSON.stringify({ claimId: "c1", verdict: "partially_entailed", narrowedText: "候选人在富途负责 Hybrid RAG 检索。" }), inputTokens: 10, outputTokens: 5 })
      .mockResolvedValueOnce({ content: JSON.stringify({ claimId: "c2", verdict: "unsupported" }), inputTokens: 8, outputTokens: 3 });

    const result = await generateVerifiedRagAnswer({
      question: "候选人在富途负责什么？",
      evidence: [first, second],
      coverage: "full",
      unsupportedAspects: [],
      settings: { answerTone: "professional", privacySafeMode: true },
      generatorClient: { complete: generator },
      verifierClient: { complete: verifier },
    });

    expect(result.answer).toContain("候选人在富途负责 Hybrid RAG 检索。");
    expect(result.answer).not.toContain("不存在的业绩");
    expect(result.citations.map((item) => item.evidenceId)).toEqual([first.evidenceId]);
    expect(result.claims).toHaveLength(1);
  });

  it("reports verifier failures as system failures instead of insufficient evidence", async () => {
    const item = evidence("11111111-1111-4111-8111-111111111111", "富途职责证据");
    const generator = { complete: vi.fn().mockResolvedValue({ content: JSON.stringify({ coverage: "full", claims: [{ claimId: "c1", aspectId: "a1", text: "富途职责证据", evidenceIds: [item.evidenceId] }], unsupportedAspectIds: [] }), inputTokens: 1, outputTokens: 1 }) };
    const verifier = { complete: vi.fn().mockRejectedValue(new Error("down")) };

    await expect(generateVerifiedRagAnswer({ question: "富途职责是什么？", evidence: [item], coverage: "full", unsupportedAspects: [], settings: { answerTone: "concise", privacySafeMode: true }, generatorClient: generator, verifierClient: verifier }))
      .rejects.toMatchObject({ code: "AI_CLAIM_VERIFIER_FAILED" });
  });

  it("accepts an explicit null narrowedText from an entailed verifier verdict", async () => {
    const item = evidence("11111111-1111-4111-8111-111111111111", "候选人在富途负责 Kubernetes 命名服务。");
    const generator = { complete: vi.fn().mockResolvedValue({ content: JSON.stringify({ coverage: "full", claims: [{ claimId: "c1", aspectId: "a1", text: "候选人在富途负责 Kubernetes 命名服务。", evidenceIds: [item.evidenceId] }], unsupportedAspectIds: [] }), inputTokens: 1, outputTokens: 1 }) };
    const verifier = { complete: vi.fn().mockResolvedValue({ content: JSON.stringify({ claimId: "c1", verdict: "entailed", narrowedText: null }), inputTokens: 1, outputTokens: 1 }) };

    await expect(generateVerifiedRagAnswer({ question: "候选人在富途负责什么？", evidence: [item], coverage: "full", unsupportedAspects: [], settings: { answerTone: "professional", privacySafeMode: true }, generatorClient: generator, verifierClient: verifier }))
      .resolves.toMatchObject({ outcome: "answered", answer: "候选人在富途负责 Kubernetes 命名服务。" });
  });

  it("uses the Host date for relative-time answers instead of guessing the current year", async () => {
    const item = evidence("11111111-1111-4111-8111-111111111111", "候选人自2017年开始从事后台和平台研发。");
    const generator = vi.fn<AnswerClient["complete"]>().mockResolvedValue({
      content: JSON.stringify({ coverage: "full", claims: [{ claimId: "c1", aspectId: "a1", text: "从2017年至2025年，约8年工作经验。", evidenceIds: [item.evidenceId] }], unsupportedAspectIds: [] }),
      inputTokens: 1,
      outputTokens: 1,
    });
    const verifier = { complete: vi.fn().mockResolvedValue({ content: JSON.stringify({ claimId: "c1", verdict: "entailed", narrowedText: null }), inputTokens: 1, outputTokens: 1 }) };

    const result = await generateVerifiedRagAnswer({
      question: "工作多少年了？",
      evidence: [item],
      coverage: "full",
      unsupportedAspects: [],
      currentDate: "2026-08-14",
      settings: { answerTone: "professional", privacySafeMode: true },
      generatorClient: { complete: generator },
      verifierClient: verifier,
    });

    const systemPrompt = generator.mock.calls[0]![0][0]!.content;
    expect(systemPrompt).toContain("2026-08-14");
    expect(result.answer).toContain("2026年");
    expect(result.answer).toContain("约9年");
    expect(result.answer).not.toContain("2025年");
  });

  it("completes a duration answer from a verified start date when the provider omits the elapsed years", async () => {
    const item = evidence("11111111-1111-4111-8111-111111111111", "候选人自2017年1月起持续从事后台、平台与 AI Agent 工程工作。");
    const generator = { complete: vi.fn().mockResolvedValue({
      content: JSON.stringify({ coverage: "full", claims: [{ claimId: "c1", aspectId: "a1", text: "自2017年1月起持续从事后台、平台与 AI Agent 工程工作。", evidenceIds: [item.evidenceId] }], unsupportedAspectIds: [] }),
      inputTokens: 1,
      outputTokens: 1,
    }) };
    const verifier = { complete: vi.fn().mockResolvedValue({ content: JSON.stringify({ claimId: "c1", verdict: "entailed", narrowedText: null }), inputTokens: 1, outputTokens: 1 }) };

    const result = await generateVerifiedRagAnswer({
      question: "工作多少年了？",
      evidence: [item],
      coverage: "full",
      unsupportedAspects: [],
      currentDate: "2026-08-14",
      settings: { answerTone: "professional", privacySafeMode: true },
      generatorClient: generator,
      verifierClient: verifier,
    });

    expect(result.answer).toContain("截至2026年8月");
    expect(result.answer).toContain("约9年7个月");
    expect(result.answer).not.toContain("2025年");
  });

  it("normalizes a provider aspect alias to the only Host-defined aspect", async () => {
    const item = evidence("11111111-1111-4111-8111-111111111111", "候选人自2017年开始从事后台和平台研发。");
    const generator = { complete: vi.fn().mockResolvedValue({
      content: JSON.stringify({ coverage: "full", claims: [{ claimId: "c1", aspectId: "工作年限", text: "从2017年至2026年，约9年工作经验。", evidenceIds: [item.evidenceId] }], unsupportedAspectIds: [] }),
      inputTokens: 1,
      outputTokens: 1,
    }) };
    const verifier = { complete: vi.fn().mockResolvedValue({ content: JSON.stringify({ claimId: "c1", verdict: "entailed", narrowedText: null }), inputTokens: 1, outputTokens: 1 }) };

    const result = await generateVerifiedRagAnswer({
      question: "工作多少年了？",
      evidence: [item],
      coverage: "full",
      unsupportedAspects: ["工作年限"],
      currentDate: "2026-08-14",
      settings: { answerTone: "professional", privacySafeMode: true },
      generatorClient: generator,
      verifierClient: verifier,
    });

    expect(result).toMatchObject({ outcome: "answered", coverage: "full" });
    expect(result.claims[0]?.aspectId).toBe("a1");
  });

  it("renders every compound-question aspect in order and discloses unsupported aspects", async () => {
    const item = evidence("11111111-1111-4111-8111-111111111111", "候选人先后在圆币科技、富途控股和欢聚时代工作，经历包含任职时间、平台职责与项目成果。");
    const generator = { complete: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        coverage: "partial",
        claims: [
          { claimId: "c1", aspectId: "a1", text: "先后任职于圆币科技、富途控股和欢聚时代。", evidenceIds: [item.evidenceId] },
          { claimId: "c2", aspectId: "a2", text: "授权资料记录了各段经历的任职时间。", evidenceIds: [item.evidenceId] },
          { claimId: "c3", aspectId: "a3", text: "主要负责 Infra、云原生平台和后台研发。", evidenceIds: [item.evidenceId] },
        ],
        unsupportedAspectIds: ["a4"],
      }),
      inputTokens: 1,
      outputTokens: 1,
    }) };
    const verifier = { complete: vi.fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ claimId: "c1", verdict: "entailed", narrowedText: null }), inputTokens: 1, outputTokens: 1 })
      .mockResolvedValueOnce({ content: JSON.stringify({ claimId: "c2", verdict: "entailed", narrowedText: null }), inputTokens: 1, outputTokens: 1 })
      .mockResolvedValueOnce({ content: JSON.stringify({ claimId: "c3", verdict: "entailed", narrowedText: null }), inputTokens: 1, outputTokens: 1 }) };
    const answerAspects = [
      { aspectId: "a1", label: "先后在哪些公司工作" },
      { aspectId: "a2", label: "分别是什么时候" },
      { aspectId: "a3", label: "负责什么工作" },
      { aspectId: "a4", label: "取得哪些成就" },
    ];

    const result = await generateVerifiedRagAnswer({
      question: "先后在哪些公司工作？分别是什么时候？负责什么工作，取得哪些成就？",
      answerAspects,
      evidence: [item],
      coverage: "full",
      unsupportedAspects: [],
      currentDate: "2026-08-14",
      settings: { answerTone: "professional", privacySafeMode: true },
      generatorClient: generator,
      verifierClient: verifier,
    });

    expect(result.answer).toContain("### 先后在哪些公司工作");
    expect(result.answer.indexOf("### 分别是什么时候")).toBeGreaterThan(result.answer.indexOf("### 先后在哪些公司工作"));
    expect(result.answer.indexOf("### 负责什么工作")).toBeGreaterThan(result.answer.indexOf("### 分别是什么时候"));
    expect(result.answer.indexOf("### 取得哪些成就")).toBeGreaterThan(result.answer.indexOf("### 负责什么工作"));
    expect(result.answer).toContain("当前授权证据尚不能支持这个方面");
    expect(result.coverage).toBe("partial");
  });

  it("rejects repeated claims instead of publishing semantic duplicates as completeness", async () => {
    const item = evidence("11111111-1111-4111-8111-111111111111", "候选人在圆币科技负责 Infra 平台建设并交付 Ferry 多集群 CI/CD 平台。");
    const repeated = "在圆币科技负责 Infra 平台建设并交付 Ferry 多集群 CI/CD 平台。";
    const generator = { complete: vi.fn().mockResolvedValue({ content: JSON.stringify({ coverage: "full", claims: [
      { claimId: "c1", aspectId: "a1", text: repeated, evidenceIds: [item.evidenceId] },
      { claimId: "c2", aspectId: "a2", text: repeated, evidenceIds: [item.evidenceId] },
    ], unsupportedAspectIds: [] }), inputTokens: 1, outputTokens: 1 }) };
    const verifier = { complete: vi.fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ claimId: "c1", verdict: "entailed", narrowedText: null }), inputTokens: 1, outputTokens: 1 })
      .mockResolvedValueOnce({ content: JSON.stringify({ claimId: "c2", verdict: "entailed", narrowedText: null }), inputTokens: 1, outputTokens: 1 }) };

    await expect(generateVerifiedRagAnswer({
      question: "负责什么工作，取得哪些成就？",
      answerAspects: [{ aspectId: "a1", label: "负责什么工作" }, { aspectId: "a2", label: "取得哪些成就" }],
      evidence: [item],
      coverage: "full",
      unsupportedAspects: [],
      currentDate: "2026-08-14",
      settings: { answerTone: "professional", privacySafeMode: true },
      generatorClient: generator,
      verifierClient: verifier,
    })).rejects.toMatchObject({ code: "AI_ANSWER_REDUNDANT" });
  });

  it("keeps necessary cross-aspect context when an achievement extends a responsibility", async () => {
    const item = evidence("11111111-1111-4111-8111-111111111111", "候选人在圆币科技负责 Infra 平台建设，并交付 Ferry 多集群 CI/CD 平台。");
    const generator = { complete: vi.fn().mockResolvedValue({ content: JSON.stringify({ coverage: "full", claims: [
      { claimId: "c1", aspectId: "a1", text: "在圆币科技负责 Infra 平台建设。", evidenceIds: [item.evidenceId] },
      { claimId: "c2", aspectId: "a2", text: "在圆币科技负责 Infra 平台建设，并交付 Ferry 多集群 CI/CD 平台。", evidenceIds: [item.evidenceId] },
    ], unsupportedAspectIds: [] }), inputTokens: 1, outputTokens: 1 }) };
    const verifier = { complete: vi.fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ claimId: "c1", verdict: "entailed", narrowedText: null }), inputTokens: 1, outputTokens: 1 })
      .mockResolvedValueOnce({ content: JSON.stringify({ claimId: "c2", verdict: "entailed", narrowedText: null }), inputTokens: 1, outputTokens: 1 }) };

    const result = await generateVerifiedRagAnswer({
      question: "负责什么工作，取得哪些成就？",
      answerAspects: [{ aspectId: "a1", label: "负责什么工作" }, { aspectId: "a2", label: "取得哪些成就" }],
      evidence: [item],
      coverage: "full",
      unsupportedAspects: [],
      currentDate: "2026-08-14",
      settings: { answerTone: "professional", privacySafeMode: true },
      generatorClient: generator,
      verifierClient: verifier,
    });

    expect(result.answer).toContain("### 负责什么工作");
    expect(result.answer).toContain("### 取得哪些成就");
    expect(result.claims).toHaveLength(2);
  });
});

describe("persistRagAnswerCitations", () => {
  it("stores only V2 identity and safe location metadata, not evidence body snapshots", async () => {
    const item = evidence("11111111-1111-4111-8111-111111111111", "private body must not persist");
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });

    await persistRagAnswerCitations({ query } as never, "99999999-9999-4999-8999-999999999999", "88888888-8888-4888-8888-888888888888", [item]);

    expect(query).toHaveBeenCalledOnce();
    expect(JSON.stringify(query.mock.calls[0])).not.toContain("private body must not persist");
  });
});
