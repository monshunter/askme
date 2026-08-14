import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { RuntimeConfig } from "@/server/config";

import { loadQuestionRepositories } from "./question-context";

describe("loadQuestionRepositories", () => {
  it("does not read daily quota usage when deciding Candidate or Public Conversation Deep availability", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "monshunter/copybook",
      publicDeepAnalysisEnabled: true,
    }] });
    const pool = { query } as unknown as Pool;
    const config = { codeAgent: { dailyQuotas: { global: 1, candidate: 1, repository: 1 } } } as unknown as RuntimeConfig;

    await expect(loadQuestionRepositories({ pool, config, ownerId: "owner", mode: "candidate" }))
      .resolves.toEqual([{ id: "11111111-1111-4111-8111-111111111111", displayName: "monshunter/copybook", deepAllowed: true }]);
    await expect(loadQuestionRepositories({ pool, config, ownerId: "owner", mode: "public", publicationId: "publication", visitorKey: "visitor" }))
      .resolves.toEqual([{ id: "11111111-1111-4111-8111-111111111111", displayName: "monshunter/copybook", deepAllowed: true }]);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.every(([sql]) => !String(sql).includes("analysis_quota_usage"))).toBe(true);
  });

  it("keeps the Candidate-controlled public Deep flag authoritative", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "monshunter/copybook",
      publicDeepAnalysisEnabled: false,
    }] });
    const result = await loadQuestionRepositories({ pool: { query } as unknown as Pool, config: {} as RuntimeConfig, ownerId: "owner", mode: "public" });
    expect(result[0]?.deepAllowed).toBe(false);
  });
});
