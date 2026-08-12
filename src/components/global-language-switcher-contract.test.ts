import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = path.resolve(import.meta.dirname, "..");

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(target);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [target] : [];
  });
}

describe("global language-switcher placement", () => {
  it("renders one shared switcher from the root layout and nowhere else", () => {
    const renderers = tsxFiles(srcRoot)
      .filter((file) => !file.endsWith(".test.tsx"))
      .filter((file) => readFileSync(file, "utf8").includes("<LanguageSwitcher"))
      .map((file) => path.relative(srcRoot, file));

    expect(renderers).toEqual([path.join("app", "layout.tsx")]);
    const rootLayout = readFileSync(path.join(srcRoot, "app", "layout.tsx"), "utf8");
    expect(rootLayout.match(/<LanguageSwitcher/g)).toHaveLength(1);
    expect(rootLayout).toContain("global-language-control");
  });
});
