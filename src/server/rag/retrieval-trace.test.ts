import { describe, expect, it, vi } from "vitest";

import { getRuntimeConfig } from "@/server/config";

import { persistRetrievalTrace } from "./retrieval-trace";
import { analyzeDeterministicQuery } from "./query-planner";

describe("persistRetrievalTrace", () => {
  it("stores safe diagnostics without question, evidence body, prompt, or vectors", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "trace" }] });
    const plan = analyzeDeterministicQuery("secret question text");
    const config = getRuntimeConfig();
    await persistRetrievalTrace({ query } as never, {
      ownerId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      messageId: "33333333-3333-4333-8333-333333333333",
      callerMode: "candidate_preview",
      config,
      result: {
        plan,
        candidates: [],
        coverage: "none",
        unsupportedAspects: [],
        roundCount: 1,
        routeCounts: [{ exact: 0, lexical: 0, vector: 0, structured: 0 }],
        degradations: ["rerank_fallback"],
        configuredTokens: 200_000,
        effectiveTokens: 100_000,
        actualTokens: 0,
      },
      latencyMs: 12,
    });

    const serialized = JSON.stringify(query.mock.calls[0]);
    expect(serialized).not.toContain("secret question text");
    expect(serialized).not.toContain("parentContent");
    expect(serialized).not.toContain("embedding");
    expect(serialized).toContain("rerank_fallback");
  });
});
