import { describe, expect, it, vi } from "vitest";

import { maintainEphemeralPublicState } from "./public-retention";

describe("maintainEphemeralPublicState", () => {
  it("removes expired public conversations and stale rate-limit buckets", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 2 }).mockResolvedValueOnce({ rowCount: 3 });
    await expect(maintainEphemeralPublicState({ query })).resolves.toEqual({ conversations: 2, rateLimits: 3 });
    expect(query.mock.calls[0]?.[0]).toContain("mode='public'");
    expect(query.mock.calls[1]?.[0]).toContain("public_rate_limits");
  });
});
