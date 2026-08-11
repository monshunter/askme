import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { parseChatInput, parseFeedbackInput } from "./agent-input";

describe("Agent API input", () => {
  it("parses bounded chat input with idempotency and optional conversation", () => {
    expect(parseChatInput({ clientMessageId: "11111111-1111-4111-8111-111111111111", question: "  Tell me about Askme.  " })).toEqual({
      clientMessageId: "11111111-1111-4111-8111-111111111111",
      question: "Tell me about Askme.",
    });
    expect(parseChatInput({ clientMessageId: "11111111-1111-4111-8111-111111111111", conversationId: "22222222-2222-4222-8222-222222222222", question: "Askme?" }).conversationId).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("rejects malformed ids, empty questions, and extra fields", () => {
    for (const input of [
      { clientMessageId: "bad", question: "Askme?" },
      { clientMessageId: "11111111-1111-4111-8111-111111111111", conversationId: "bad", question: "Askme?" },
      { clientMessageId: "11111111-1111-4111-8111-111111111111", question: "" },
      { clientMessageId: "11111111-1111-4111-8111-111111111111", question: "Askme?", ownerId: "other" },
    ]) expect(() => parseChatInput(input)).toThrowError(expect.objectContaining({ code: "INVALID_CHAT_INPUT" }) as Partial<AppError>);
  });

  it("accepts only explicit feedback values", () => {
    expect(parseFeedbackInput({ value: "up" })).toEqual({ value: "up" });
    expect(parseFeedbackInput({ value: "down" })).toEqual({ value: "down" });
    expect(() => parseFeedbackInput({ value: "neutral" })).toThrowError(expect.objectContaining({ code: "INVALID_FEEDBACK" }) as Partial<AppError>);
  });
});
