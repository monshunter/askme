import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { recordQuestionRoute } from "./question-route-audit";

describe("recordQuestionRoute", () => {
  it("persists only safe route metadata without question or answer content", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await recordQuestionRoute({ query } as unknown as Pool, {
      ownerId: "11111111-1111-4111-8111-111111111111",
      actorRole: "candidate",
      conversationId: "22222222-2222-4222-8222-222222222222",
      requestedRoute: "deep",
      effectiveRoute: "deep",
      reasonCode: "source_inspection_required",
      confidence: 0.92,
      repositoryId: "33333333-3333-4333-8333-333333333333",
      evidenceCount: 4,
      requestId: "request",
    });

    const metadata = JSON.parse(String(query.mock.calls[0]?.[1]?.[5]));
    expect(metadata).toEqual({
      requestedRoute: "deep",
      effectiveRoute: "deep",
      reasonCode: "source_inspection_required",
      confidence: 0.92,
      repositoryId: "33333333-3333-4333-8333-333333333333",
      evidenceCount: 4,
    });
    expect(JSON.stringify(metadata)).not.toMatch(/question|answer|prompt|reasoning/i);
  });
});
