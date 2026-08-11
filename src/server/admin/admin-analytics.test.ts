import { describe, expect, it } from "vitest";

import { buildUtcDateBuckets, comparableChange } from "./admin-analytics";

describe("Admin analytics", () => {
  it("builds continuous UTC buckets without sample values", () => {
    expect(buildUtcDateBuckets("2026-08-11T12:30:00.000Z", 3)).toEqual(["2026-08-09", "2026-08-10", "2026-08-11"]);
  });

  it("returns no invented percentage without a prior baseline", () => {
    expect(comparableChange(10, 0)).toBeNull();
    expect(comparableChange(15, 10)).toBe(50);
    expect(comparableChange(8, 10)).toBe(-20);
  });
});
