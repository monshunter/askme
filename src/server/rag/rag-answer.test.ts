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
          { claimId: "c2", aspectId: "a2", text: "候选人创造了不存在的业绩。", evidenceIds: [second.evidenceId] },
        ],
        unsupportedAspects: [],
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
    const generator = { complete: vi.fn().mockResolvedValue({ content: JSON.stringify({ coverage: "full", claims: [{ claimId: "c1", aspectId: "a1", text: "富途职责证据", evidenceIds: [item.evidenceId] }], unsupportedAspects: [] }), inputTokens: 1, outputTokens: 1 }) };
    const verifier = { complete: vi.fn().mockRejectedValue(new Error("down")) };

    await expect(generateVerifiedRagAnswer({ question: "富途职责是什么？", evidence: [item], coverage: "full", unsupportedAspects: [], settings: { answerTone: "concise", privacySafeMode: true }, generatorClient: generator, verifierClient: verifier }))
      .rejects.toMatchObject({ code: "AI_CLAIM_VERIFIER_FAILED" });
  });

  it("accepts an explicit null narrowedText from an entailed verifier verdict", async () => {
    const item = evidence("11111111-1111-4111-8111-111111111111", "候选人在富途负责 Kubernetes 命名服务。");
    const generator = { complete: vi.fn().mockResolvedValue({ content: JSON.stringify({ coverage: "full", claims: [{ claimId: "c1", aspectId: "a1", text: "候选人在富途负责 Kubernetes 命名服务。", evidenceIds: [item.evidenceId] }], unsupportedAspects: [] }), inputTokens: 1, outputTokens: 1 }) };
    const verifier = { complete: vi.fn().mockResolvedValue({ content: JSON.stringify({ claimId: "c1", verdict: "entailed", narrowedText: null }), inputTokens: 1, outputTokens: 1 }) };

    await expect(generateVerifiedRagAnswer({ question: "候选人在富途负责什么？", evidence: [item], coverage: "full", unsupportedAspects: [], settings: { answerTone: "professional", privacySafeMode: true }, generatorClient: generator, verifierClient: verifier }))
      .resolves.toMatchObject({ outcome: "answered", answer: "候选人在富途负责 Kubernetes 命名服务。" });
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
