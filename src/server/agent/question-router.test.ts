import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

import { effectiveQuestionRoute, routeQuestion, selectInsufficientEvidenceRepository, selectSourceInspectionRepository, type QuestionRouterClient } from "./question-router";

const repositories = [
  { id: "11111111-1111-4111-8111-111111111111", displayName: "Askme", deepAllowed: true },
  { id: "22222222-2222-4222-8222-222222222222", displayName: "Ferry", deepAllowed: false },
];

function client(content: unknown): QuestionRouterClient {
  return {
    complete: vi.fn().mockResolvedValue({
      content: typeof content === "string" ? content : JSON.stringify(content),
      inputTokens: 20,
      outputTokens: 8,
    }),
  };
}

describe("routeQuestion", () => {
  it("selects one authorized Repository for an explicit function implementation question", () => {
    expect(selectSourceInspectionRepository("copybook 的 `paginate` 函数在分页时如何处理剩余格子？", repositories)).toEqual(repositories[0]);
    expect(selectSourceInspectionRepository("What does Askme do?", repositories)).toBeNull();
    expect(effectiveQuestionRoute({ route: "rag", reasonCode: "evidence_sufficient", confidence: 0.95 }, repositories[0]!, true)).toBe("deep");
  });

  it("does not let the model turn a Host-allowed career question with no evidence into an out-of-scope refusal", () => {
    expect(effectiveQuestionRoute({ route: "refuse", reasonCode: "out_of_scope", confidence: 1 }, null)).toBe("rag");
    expect(effectiveQuestionRoute({ route: "refuse", reasonCode: "insufficient_authorized_evidence", confidence: 1 }, null)).toBe("rag");
    expect(effectiveQuestionRoute({ route: "refuse", reasonCode: "ambiguous_repository", confidence: 1 }, null)).toBe("refuse");
  });

  it("does not guess the only Repository when RAG evidence is insufficient", () => {
    const oneCat = { id: "33333333-3333-4333-8333-333333333333", displayName: "OneCat", deepAllowed: true };
    expect(selectInsufficientEvidenceRepository("Askme 项目呢？", { route: "refuse", repositoryId: null }, [oneCat])).toBeNull();
    expect(selectInsufficientEvidenceRepository("Askme 项目呢？", { route: "rag", repositoryId: null }, [oneCat])).toBeNull();
    expect(selectInsufficientEvidenceRepository("Askme 项目呢？", { route: "deep", repositoryId: oneCat.id }, [oneCat])).toBeNull();
    expect(selectInsufficientEvidenceRepository("Askme 项目呢？", { route: "rag", repositoryId: oneCat.id }, [oneCat])).toBeNull();
    expect(selectInsufficientEvidenceRepository("OneCat 项目呢？", { route: "rag", repositoryId: oneCat.id }, [oneCat])).toEqual(oneCat);
  });
  it("accepts a deep route only for a Host-authorized Repository", async () => {
    const result = await routeQuestion({
      question: "How is Askme repository analysis isolated?",
      evidenceSummaries: ["Askme uses a Repository Dossier."],
      repositories,
    }, client({ route: "deep", reasonCode: "source_inspection_required", confidence: 0.91, repositoryId: repositories[0]!.id }));

    expect(result).toMatchObject({ route: "deep", reasonCode: "source_inspection_required", repositoryId: repositories[0]!.id, confidence: 0.91 });
  });

  it("cannot expand a Repository deep-analysis gate", async () => {
    const result = await routeQuestion({
      question: "Inspect Ferry internals",
      evidenceSummaries: [],
      repositories,
    }, client({ route: "deep", reasonCode: "source_inspection_required", confidence: 0.9, repositoryId: repositories[1]!.id }));

    expect(result).toEqual({
      route: "refuse",
      reasonCode: "deep_analysis_not_allowed",
      confidence: 1,
      repositoryId: repositories[1]!.id,
      usage: { inputTokens: 20, outputTokens: 8 },
    });
  });

  it("rejects a repository id outside the Host candidate set", async () => {
    await expect(routeQuestion({
      question: "Inspect another repository",
      evidenceSummaries: [],
      repositories,
    }, client({ route: "deep", reasonCode: "source_inspection_required", confidence: 0.9, repositoryId: "33333333-3333-4333-8333-333333333333" })))
      .rejects.toEqual(expect.objectContaining<Partial<AppError>>({ code: "AI_ROUTER_INVALID" }));
  });

  it("requires one repository for deep and none for a repository-free rag decision", async () => {
    await expect(routeQuestion({
      question: "Inspect code",
      evidenceSummaries: [],
      repositories,
    }, client({ route: "deep", reasonCode: "source_inspection_required", confidence: 0.8, repositoryId: null })))
      .rejects.toEqual(expect.objectContaining<Partial<AppError>>({ code: "AI_ROUTER_INVALID" }));

    const rag = await routeQuestion({ question: "What is the candidate's background?", evidenceSummaries: ["Career summary"], repositories }, client({ route: "rag", reasonCode: "evidence_sufficient", confidence: 0.7, repositoryId: null }));
    expect(rag).toMatchObject({ route: "rag", reasonCode: "evidence_sufficient", repositoryId: null, confidence: 0.7 });
  });

  it("fails closed on malformed model output", async () => {
    await expect(routeQuestion({ question: "Question", evidenceSummaries: [], repositories }, client("not-json")))
      .rejects.toEqual(expect.objectContaining<Partial<AppError>>({ code: "AI_ROUTER_INVALID" }));
  });

  it("normalizes harmless JSON-mode variation while keeping Host repository validation authoritative", async () => {
    const result = await routeQuestion({
      question: "How is the release version determined?",
      evidenceSummaries: ["The version is injected at build time."],
      repositories,
    }, client({
      route: "rag",
      reasonCode: "evidence_sufficient",
      confidence: "0.95",
      diagnostic: "ignored",
    }));

    expect(result).toMatchObject({ route: "rag", confidence: 0.95, repositoryId: null });
  });
});
