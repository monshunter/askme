import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("RAG index smoke cleanup", () => {
  it("removes its database user and unreferenced artifact in finally", () => {
    const source = readFileSync(path.resolve(process.cwd(), "scripts/smoke-rag-index-foundation.ts"), "utf8");

    expect(source).toContain("DELETE FROM users WHERE id=$1");
    expect(source).toContain("DELETE FROM repository_artifacts WHERE content_key=$1");
    expect(source.indexOf("DELETE FROM users WHERE id=$1")).toBeGreaterThan(source.indexOf("finally"));
    expect(source).toContain("state IN ('queued','processing')");
    expect(source).toContain("RAG_INDEX_SMOKE_TIMEOUT");
    expect(source).not.toContain("if (!lease) break;");
  });
});
