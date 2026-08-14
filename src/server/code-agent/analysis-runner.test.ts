import { describe, expect, it } from "vitest";

import { conversationCorrectionPrompt } from "./analysis-runner";

describe("conversationCorrectionPrompt", () => {
  it("repeats the original question and invalid result for a fresh bounded correction run", () => {
    const prompt = conversationCorrectionPrompt({
      userQuestion: "请检查 PDF 导出的逐页处理流程。",
      repositoryDisplayName: "monshunter/copybook",
      commitSha: "a".repeat(40),
    }, "CODE_ANSWER_LANGUAGE_MISMATCH", {
      result: { outcome: "answered", answerMarkdown: "English answer", citations: [] },
    });

    expect(prompt).toContain("请检查 PDF 导出的逐页处理流程。");
    expect(prompt).toContain("monshunter/copybook");
    expect(prompt).toContain("same primary language");
    expect(prompt).toContain("CODE_ANSWER_LANGUAGE_MISMATCH");
    expect(prompt).toContain("English answer");
  });
});
