import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = path.resolve(import.meta.dirname, "..");

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(target);
    return entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [target] : [];
  });
}

describe("Askme Chinese brand name", () => {
  it("uses 职问 and retires 问候 from every rendered TSX surface", () => {
    const sources = tsxFiles(srcRoot).map((file) => readFileSync(file, "utf8"));

    expect(sources.some((source) => source.includes("职问"))).toBe(true);
    expect(sources.filter((source) => source.includes("问候"))).toEqual([]);
  });
});
