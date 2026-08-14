import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("RAG rebuild command", () => {
  it("waits for sources claimed by a concurrent worker before activation", () => {
    const source = readFileSync(path.resolve(process.cwd(), "scripts/rebuild-rag-index.ts"), "utf8");

    expect(source).toContain("state IN ('queued','processing')");
    expect(source).toContain("RAG_INDEX_REBUILD_TIMEOUT");
    expect(source).not.toContain("if (!lease) break;");
  });
});
