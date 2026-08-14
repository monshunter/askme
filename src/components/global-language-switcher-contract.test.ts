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
  it("keeps one global switcher outside public Agent pages and embeds the public switcher beside trust", () => {
    const renderers = tsxFiles(srcRoot)
      .filter((file) => !file.endsWith(".test.tsx"))
      .filter((file) => readFileSync(file, "utf8").includes("<LanguageSwitcher"))
      .map((file) => path.relative(srcRoot, file));

    expect(renderers).toEqual([
      path.join("components", "global-language-control.tsx"),
      path.join("components", "public", "public-agent-client.tsx"),
    ]);
    const rootLayout = readFileSync(path.join(srcRoot, "app", "layout.tsx"), "utf8");
    expect(rootLayout).toContain("<GlobalLanguageControl");

    const globalControl = readFileSync(path.join(srcRoot, "components", "global-language-control.tsx"), "utf8");
    expect(globalControl).toContain("usePathname");
    expect(globalControl).toContain('pathname.startsWith("/a/")');

    const publicAgent = readFileSync(path.join(srcRoot, "components", "public", "public-agent-client.tsx"), "utf8");
    expect(publicAgent.indexOf('className="public-trust"')).toBeLessThan(publicAgent.indexOf("<LanguageSwitcher"));

    const css = readFileSync(path.join(srcRoot, "app", "globals.css"), "utf8");
    expect(css).not.toContain(".public-trust { margin-right:");
  });
});
