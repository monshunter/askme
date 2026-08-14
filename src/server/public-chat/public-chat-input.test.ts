import { describe, expect, it } from "vitest";

import { parsePublicChatInput, parsePublicFeedbackInput } from "./public-chat-input";

describe("public chat input", () => {
  it("accepts a strict idempotent question", () => {
    expect(parsePublicChatInput({ conversationId: "22222222-2222-4222-8222-222222222222", clientMessageId: "11111111-1111-4111-8111-111111111111", question: "  What did the candidate build?  " })).toEqual({
      conversationId: "22222222-2222-4222-8222-222222222222",
      clientMessageId: "11111111-1111-4111-8111-111111111111",
      question: "What did the candidate build?",
    });
    expect(parsePublicChatInput({ conversationId: "22222222-2222-4222-8222-222222222222", clientMessageId: "11111111-1111-4111-8111-111111111111", question: "  **Impact**\n\n1. Scale\n2. Reliability  " }).question).toBe("**Impact**\n\n1. Scale\n2. Reliability");
  });

  it("requires a valid selected conversation and rejects invalid feedback", () => {
    expect(() => parsePublicChatInput({ clientMessageId: "11111111-1111-4111-8111-111111111111", question: "Question" })).toThrowError(expect.objectContaining({ code: "INVALID_PUBLIC_CHAT_INPUT" }));
    expect(() => parsePublicChatInput({ conversationId: "not-a-conversation", clientMessageId: "11111111-1111-4111-8111-111111111111", question: "Question" })).toThrowError(expect.objectContaining({ code: "INVALID_PUBLIC_CHAT_INPUT" }));
    expect(() => parsePublicFeedbackInput({ value: "flag" })).toThrowError(expect.objectContaining({ code: "INVALID_FEEDBACK" }));
  });
});
