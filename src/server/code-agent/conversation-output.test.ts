import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { validateCodeAnswerOutput } from "./conversation-output";

const evidence = {
  eligibleFileCount: 1,
  manifestPaths: new Set(["src/answer.ts"]),
  sources: new Map([["src/answer.ts", "export const answer = 42;\n"]]),
  artifactSkipped: { binary: 0, default_excluded: 0, custom_excluded: 0, special: 0 },
};

describe("validateCodeAnswerOutput", () => {
  it("accepts an answered result only with an exact immutable source Citation", () => {
    expect(validateCodeAnswerOutput({
      outcome: "answered",
      answerMarkdown: "The answer constant is 42.",
      citations: [{ path: "src/answer.ts", lineStart: 1, lineEnd: 1, contentHash: "8ddd56a4478052aac936a9d31d6ef165ee3968c394156d6eb2856438c23cb8f1" }],
    }, evidence)).toMatchObject({ outcome: "answered" });
  });

  it("rejects a source hash that does not match the bound Revision", () => {
    expect(() => validateCodeAnswerOutput({
      outcome: "answered",
      answerMarkdown: "Unsupported.",
      citations: [{ path: "src/answer.ts", lineStart: 1, lineEnd: 1, contentHash: "a".repeat(64) }],
    }, evidence)).toThrowError(expect.objectContaining<Partial<AppError>>({ code: "CODE_ANSWER_CITATION_HASH_INVALID" }));
  });

  it("keeps insufficient and refused outcomes citation-free", () => {
    expect(validateCodeAnswerOutput({ outcome: "insufficient", answerMarkdown: "Not enough source evidence.", citations: [] }, evidence)).toMatchObject({ outcome: "insufficient" });
    expect(() => validateCodeAnswerOutput({
      outcome: "refused",
      answerMarkdown: "Cannot perform that action.",
      citations: [{ path: "src/answer.ts", lineStart: 1, lineEnd: 1, contentHash: "8ddd56a4478052aac936a9d31d6ef165ee3968c394156d6eb2856438c23cb8f1" }],
    }, evidence)).toThrowError(expect.objectContaining<Partial<AppError>>({ code: "CODE_ANSWER_OUTPUT_INVALID" }));
  });
});
