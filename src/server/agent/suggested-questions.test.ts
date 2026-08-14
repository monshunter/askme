import { describe, expect, it, vi } from "vitest";

import {
  buildContextualSuggestionFallback,
  buildInitialSuggestedQuestions,
  buildSuggestionGenerationMessages,
  generateConversationSuggestedQuestions,
  suggestionContextHash,
  type SuggestionConversationMessage,
  type SuggestionKnowledgeItem,
} from "./suggested-questions";

const topics: SuggestionKnowledgeItem[] = [
  { type: "repository", title: "monshunter/copybook" },
  { type: "project", title: "Askme" },
  { type: "experience", title: "AI Agent 应用工程" },
];

const messages: SuggestionConversationMessage[] = [
  { id: "m1", role: "user", status: "completed", content: "copybook 是一个什么样的项目？" },
  { id: "m2", role: "assistant", status: "completed", content: "它是一个在浏览器中生成中英文字帖并导出 PDF 的应用。" },
  { id: "m3", role: "user", status: "completed", content: "它的 PDF 导出是如何实现的？" },
  { id: "m4", role: "assistant", status: "completed", content: "当前已批准 Wiki 只说明支持多页 PDF，没有足够源码细节。" },
];

describe("conversation suggested questions", () => {
  it("builds localized guided questions from the currently authorized project, experience and Repository topics", () => {
    const result = buildInitialSuggestedQuestions(topics, "zh-CN", 0);
    expect(result).toHaveLength(4);
    expect(result.some((question) => question.includes("copybook"))).toBe(true);
    expect(result.every((question) => question.endsWith("？"))).toBe(true);
  });

  it("binds the context version to every settled message, topics, locale and refresh cursor", () => {
    const base = suggestionContextHash({ messages, topics, locale: "zh-CN", cursor: 0 });
    expect(suggestionContextHash({ messages: messages.slice(1), topics, locale: "zh-CN", cursor: 0 })).not.toBe(base);
    expect(suggestionContextHash({ messages, topics, locale: "zh-CN", cursor: 1 })).not.toBe(base);
    expect(suggestionContextHash({ messages, topics: topics.slice(1), locale: "zh-CN", cursor: 0 })).not.toBe(base);
  });

  it("sends the entire real conversation and authorized topics to the suggestion model", async () => {
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ questions: ["PDF 导出读取了哪些源码文件？", "多页 PDF 如何创建新页面？", "字体嵌入流程是什么？", "哪些源码行直接支持这些结论？"] }),
      inputTokens: 20,
      outputTokens: 12,
    });
    const result = await generateConversationSuggestedQuestions({ messages, topics, locale: "zh-CN", cursor: 0 }, { complete });
    expect(result).toHaveLength(4);
    const prompt = buildSuggestionGenerationMessages({ messages, topics, locale: "zh-CN", cursor: 0 });
    expect(prompt[1]?.content).toContain(messages[0]!.content);
    expect(prompt[1]?.content).toContain(messages.at(-1)!.content);
    expect(prompt[1]?.content).toContain("monshunter/copybook");
    expect(complete.mock.calls[0]?.[0][1]?.content).toBe(prompt[1]?.content);
  });

  it("uses the current conversation rather than unrelated rotation when generation is unavailable", () => {
    const fallback = buildContextualSuggestionFallback(topics, messages, "zh-CN", 0);
    expect(fallback).toHaveLength(4);
    expect(fallback.some((question) => question.includes("PDF 导出"))).toBe(true);
    expect(buildContextualSuggestionFallback(topics, messages, "zh-CN", 1)).not.toEqual(fallback);
  });

  it("rejects model suggestions whose primary language differs from the current user question", async () => {
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ questions: ["How is PDF export implemented?", "Which files are involved?", "How are fonts embedded?", "Which lines support this?"] }),
      inputTokens: 20,
      outputTokens: 12,
    });
    await expect(generateConversationSuggestedQuestions({ messages, topics, locale: "zh-CN", cursor: 0 }, { complete }))
      .rejects.toMatchObject({ code: "AI_SUGGESTIONS_INVALID" });
  });
});
