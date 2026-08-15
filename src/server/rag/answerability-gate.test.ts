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
  mentions: [{ text: "OneCat", type: "project", source: "explicit" }],
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
