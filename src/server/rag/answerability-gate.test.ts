import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

import { runAnswerabilityGate } from "./answerability-gate";
import type { EntityResolution } from "./entity-catalog";
import type { RetrievedRagEvidence } from "./hybrid-retriever";

function evidence(id: string, family: string, content: string): RetrievedRagEvidence {
  return {
    evidenceId: id,
    parentId: `parent-${id}`,
    stableKey: "a".repeat(64),
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
    structurePath: "Project",
    content,
    parentContent: content,
    tokenCount: 10,
    sourceRange: { lineStart: 1, lineEnd: 2 },
    contentChecksum: "f".repeat(64),
    score: 0.9,
    rrfScore: 0.02,
    rerankScore: 0.9,
    routeRanks: { exact: 1, lexical: 1 },
  };
}

const resolution: EntityResolution = {
  mentions: [{ text: "OneCat", type: "project", source: "explicit", role: "required" }],
  resolved: [],
  missing: [],
  ambiguous: [],
  soft: [],
  scope: { materialIds: ["material"], repositoryIds: [] },
  contextReference: null,
  stopBeforeRetrieval: false,
  coverageCap: "full",
  gateReason: "resolved",
};

describe("runAnswerabilityGate", () => {
  it("tells the Provider that a context mention is not a coverage requirement", async () => {
    const project = evidence("11111111-1111-4111-8111-111111111111", "family-1", "EasyInterview 是 AI 面试训练项目。");
    const contextResolution: EntityResolution = {
      ...resolution,
      mentions: [{ text: "Askme", type: "project", source: "explicit", role: "context" }],
      soft: [{ text: "Askme", type: "project", source: "explicit", role: "context" }],
      scope: null,
      gateReason: "no_required_entity",
    };
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ aspects: [{ aspectId: "a1", status: "supported", evidenceIds: [project.evidenceId] }] }),
      inputTokens: 20,
      outputTokens: 10,
    });

    const result = await runAnswerabilityGate({
      question: "看过 Askme 后，我还做过哪些项目？",
      answerAspects: [{ aspectId: "a1", label: "项目" }],
      entityResolution: contextResolution,
      evidence: [project],
      client: { complete },
    });

    expect(result.coverage).toBe("full");
    expect(complete.mock.calls[0]?.[0]?.[0]?.content).toContain("role=context");
    expect(complete.mock.calls[0]?.[0]?.[1]?.content).toContain('\"role\":\"context\"');
  });

  it("treats unavailable required entities as partial gaps beside resolved entities", async () => {
    const askme = evidence("11111111-1111-4111-8111-111111111111", "family-1", "Askme 解决静态简历难以呈现项目深度的问题。");
    const mixedResolution: EntityResolution = {
      ...resolution,
      mentions: [
        { text: "Askme", type: "product", source: "explicit", role: "required" },
        { text: "MoonBase", type: "project", source: "explicit", role: "required" },
      ],
      resolved: [{
        mention: { text: "Askme", type: "product", source: "explicit", role: "required" },
        entity: {
          key: "product:askme",
          type: "product",
          canonicalName: "Askme",
          aliases: ["Askme"],
          materialIds: ["material"],
          repositoryIds: [],
        },
      }],
      missing: [{ text: "MoonBase", type: "project", source: "explicit", role: "required" }],
      coverageCap: "partial",
      gateReason: "resolved_with_missing",
    };
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ aspects: [{ aspectId: "a1", status: "supported", evidenceIds: [askme.evidenceId] }] }),
      inputTokens: 20,
      outputTokens: 10,
    });

    const result = await runAnswerabilityGate({
      question: "Askme 和 MoonBase 分别解决了什么问题？",
      answerAspects: [{ aspectId: "a1", label: "定位" }],
      entityResolution: mixedResolution,
      evidence: [askme],
      client: { complete },
    });

    expect(result.coverage).toBe("partial");
    expect(result.unsupportedAspects).toContain("MoonBase");
    expect(complete.mock.calls[0]?.[0]?.[0]?.content).toContain("requiredResolution.unavailable");
    expect(complete.mock.calls[0]?.[0]?.[1]?.content).toContain('\"requiredResolution\":{\"resolved\":[{\"text\":\"Askme\"');
    expect(complete.mock.calls[0]?.[0]?.[1]?.content).toContain('\"status\":\"missing\"');
  });

  it("passes only evidence selected for supported aspects to answer generation", async () => {
    const first = evidence("11111111-1111-4111-8111-111111111111", "family-1", "OneCat 是声明式 HTTP 网关。");
    const unrelated = evidence("22222222-2222-4222-8222-222222222222", "family-2", "候选人不负责云资源供应。");
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ aspects: [{ aspectId: "a1", status: "supported", evidenceIds: [first.evidenceId] }] }),
      inputTokens: 20,
      outputTokens: 10,
    });

    const result = await runAnswerabilityGate({
      question: "OneCat 项目的定位是什么？",
      answerAspects: [{ aspectId: "a1", label: "OneCat 项目的定位是什么" }],
      entityResolution: resolution,
      evidence: [first, unrelated],
      client: { complete },
    });

    expect(result.coverage).toBe("full");
    expect(result.evidence.map((item) => item.evidenceId)).toEqual([first.evidenceId]);
  });

  it("requires evidence about the candidate themselves for profile-owner questions", async () => {
    const resume = evidence("11111111-1111-4111-8111-111111111111", "family-1", "2017 年起从事后台研发与平台工作，负责核心项目交付。");
    const profileResolution: EntityResolution = {
      ...resolution,
      mentions: [],
      resolved: [],
      missing: [],
      scope: null,
      gateReason: "no_required_entity",
    };
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ aspects: [{ aspectId: "a1", status: "supported", evidenceIds: [resume.evidenceId] }] }),
      inputTokens: 20,
      outputTokens: 10,
    });

    const result = await runAnswerabilityGate({
      question: "麻烦你做一个简单的自我介绍",
      answerAspects: [{ aspectId: "a1", label: "职业概述" }],
      entityResolution: profileResolution,
      evidence: [resume],
      profileOwnerEvidence: true,
      client: { complete },
    });

    expect(result.coverage).toBe("full");
    expect(complete.mock.calls[0]?.[0]?.[0]?.content).toContain("profileOwnerEvidence=true");
    expect(complete.mock.calls[0]?.[0]?.[0]?.content).toContain("describes the candidate's own career experience");
    expect(complete.mock.calls[0]?.[0]?.[0]?.content).toContain("is not supporting evidence for such questions");
  });

  it("omits the candidate-subject constraint for questions that are not profile-owner", async () => {
    const project = evidence("11111111-1111-4111-8111-111111111111", "family-1", "OneCat 是声明式 HTTP 网关。");
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ aspects: [{ aspectId: "a1", status: "supported", evidenceIds: [project.evidenceId] }] }),
      inputTokens: 20,
      outputTokens: 10,
    });

    await runAnswerabilityGate({
      question: "OneCat 项目的定位是什么？",
      answerAspects: [{ aspectId: "a1", label: "OneCat 项目的定位是什么" }],
      entityResolution: resolution,
      evidence: [project],
      client: { complete },
    });

    expect(complete.mock.calls[0]?.[0]?.[0]?.content).not.toContain("profileOwnerEvidence");
  });

  it("rejects conflicted verdicts without two independent evidence families", async () => {
    const first = evidence("11111111-1111-4111-8111-111111111111", "same-family", "OneCat 使用 Go。");
    const second = evidence("22222222-2222-4222-8222-222222222222", "same-family", "OneCat 不使用 Go。");
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ aspects: [{ aspectId: "a1", status: "conflicted", evidenceIds: [first.evidenceId, second.evidenceId] }] }),
      inputTokens: 20,
      outputTokens: 10,
    });

    await expect(runAnswerabilityGate({
      question: "OneCat 使用什么语言？",
      answerAspects: [{ aspectId: "a1", label: "OneCat 使用什么语言" }],
      entityResolution: resolution,
      evidence: [first, second],
      client: { complete },
    })).rejects.toEqual(expect.objectContaining({ code: "AI_ANSWERABILITY_FAILED" }) as Partial<AppError>);
  });
});
