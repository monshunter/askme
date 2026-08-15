import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("RAG rebuild command", () => {
  it("is dry-run by default and requires explicit execution before activation", () => {
    const source = readFileSync(path.resolve(process.cwd(), "scripts/rebuild-knowledge-rag.ts"), "utf8");

    expect(source).toContain('process.argv.includes("--execute")');
    expect(source).toContain('process.argv.includes("--activate")');
    expect(source).toContain("if (activate && !execute)");
    expect(source).toContain('event: "knowledge-rag.rebuild.planned"');
    expect(source).toContain("rebuildKnowledge");
    expect(source).toContain("rebuildRag");
  });

  it("waits for sources claimed by a concurrent worker before activation", () => {
    const source = readFileSync(path.resolve(process.cwd(), "scripts/rebuild-rag-index.ts"), "utf8");

    expect(source).toContain("state IN ('queued','processing')");
    expect(source).toContain("RAG_INDEX_REBUILD_TIMEOUT");
    expect(source).not.toContain("if (!lease) break;");
  });
});
