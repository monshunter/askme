import { describe, expect, it, vi } from "vitest";

import { recoverStaleAnswers } from "./message-recovery";

describe("recoverStaleAnswers", () => {
  it("marks only old pending assistant placeholders as interrupted", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    await expect(recoverStaleAnswers("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", { query })).resolves.toBe(1);
    expect(query.mock.calls[0]?.[0]).toContain("status='pending'");
    expect(query.mock.calls[0]?.[0]).toContain("interval '2 minutes'");
  });
});
