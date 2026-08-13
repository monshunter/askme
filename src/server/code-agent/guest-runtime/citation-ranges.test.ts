import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

// @ts-expect-error The isolated guest runtime is shipped as native ESM JavaScript.
import { boundedCitationRanges, sourceLines } from "./citation-ranges.mjs";

describe("Code Agent guest Citation ranges", () => {
  it("uses the same trailing-newline line semantics as the Host validator", () => {
    expect(sourceLines("first\nsecond\n")).toEqual(["first", "second"]);
  });

  it("splits a 500-line read into Host-valid ranges of at most 200 lines", () => {
    const lines = Array.from({ length: 500 }, (_, index) => `line-${index + 1}`);
    const ranges = boundedCitationRanges(lines, 1, 500);
    expect(ranges.map(({ lineStart, lineEnd }: { lineStart: number; lineEnd: number }) => [lineStart, lineEnd])).toEqual([[1, 200], [201, 400], [401, 500]]);
    expect(ranges[0].contentHash).toBe(createHash("sha256").update(lines.slice(0, 200).join("\n")).digest("hex"));
  });
});
