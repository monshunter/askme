import { describe, expect, it } from "vitest";

import { encodeAnalysisRunEvent } from "./analysis-sse";

describe("Analysis Run SSE projection", () => {
  it("emits only the authorized run snapshot and stable completion metadata", () => {
    const encoded = encodeAnalysisRunEvent({
      id: "11111111-1111-4111-8111-111111111111",
      version: 7,
      state: "completed",
      phase: "completed",
      outcome: "answered",
      safeErrorCode: null,
      assistantMessageId: "22222222-2222-4222-8222-222222222222",
    });
    expect(encoded).toContain("id: 7\n");
    expect(encoded).toContain("event: run\n");
    expect(JSON.parse(encoded.match(/data: (.+)\n/)?.[1] ?? "{}")).toEqual({
      runId: "11111111-1111-4111-8111-111111111111",
      version: 7,
      state: "completed",
      phase: "completed",
      outcome: "answered",
      errorCode: null,
      completed: true,
      messageId: "22222222-2222-4222-8222-222222222222",
    });
    expect(encoded).not.toMatch(/answerMarkdown|question|citations|source|tool|prompt|reasoning/i);
  });

  it("does not expose a message id before a terminal state", () => {
    const encoded = encodeAnalysisRunEvent({
      id: "11111111-1111-4111-8111-111111111111",
      version: 2,
      state: "running",
      phase: "analyzing",
      outcome: null,
      safeErrorCode: null,
      assistantMessageId: "22222222-2222-4222-8222-222222222222",
    });
    expect(JSON.parse(encoded.match(/data: (.+)\n/)?.[1] ?? "{}")).not.toHaveProperty("messageId");
  });
});
