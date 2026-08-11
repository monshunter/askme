import { describe, expect, it } from "vitest";

import { parsePublicChatInput, parsePublicFeedbackInput } from "./public-chat-input";

describe("public chat input", () => {
  it("accepts a strict idempotent question", () => {
    expect(parsePublicChatInput({ clientMessageId: "11111111-1111-4111-8111-111111111111", question: "  What did the candidate build?  " })).toEqual({
      clientMessageId: "11111111-1111-4111-8111-111111111111",
      question: "What did the candidate build?",
    });
  });

  it("rejects client-supplied conversation identifiers and invalid feedback", () => {
    expect(() => parsePublicChatInput({ clientMessageId: "11111111-1111-4111-8111-111111111111", conversationId: "22222222-2222-4222-8222-222222222222", question: "Question" })).toThrowError(expect.objectContaining({ code: "INVALID_PUBLIC_CHAT_INPUT" }));
    expect(() => parsePublicFeedbackInput({ value: "flag" })).toThrowError(expect.objectContaining({ code: "INVALID_FEEDBACK" }));
  });
});
