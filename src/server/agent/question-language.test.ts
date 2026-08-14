import { describe, expect, it } from "vitest";

import { answerMatchesQuestionLanguage, questionLanguage } from "./question-language";

describe("question language", () => {
  it("uses Chinese when the current user question contains Chinese", () => {
    expect(questionLanguage("copybook 是一个什么样的项目？")).toBe("zh-CN");
    expect(answerMatchesQuestionLanguage("copybook 是一个什么样的项目？", "它是一个基于 React 的浏览器字帖生成项目。")).toBe(true);
    expect(answerMatchesQuestionLanguage("copybook 是一个什么样的项目？", "It is a browser application built with React.")).toBe(false);
    expect(answerMatchesQuestionLanguage(
      "copybook 的 PDF 导出流程是什么？",
      "`generatePDF` 先调用 `calculateLayout`，再遍历 `pages` 并通过 `renderPageToCanvas` 逐页写入 `jsPDF`。相关实现在 `src/lib/pdfGenerator.ts`。",
    )).toBe(true);
  });

  it("keeps English answers English while allowing source identifiers", () => {
    expect(questionLanguage("How does copybook export a PDF?")).toBe("en");
    expect(answerMatchesQuestionLanguage("How does copybook export a PDF?", "The PDF flow is implemented in src/utils/pdf.ts.")).toBe(true);
    expect(answerMatchesQuestionLanguage("How does copybook export a PDF?", "该流程在 src/utils/pdf.ts 中实现。")).toBe(false);
  });
});
