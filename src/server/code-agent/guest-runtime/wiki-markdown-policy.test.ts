import { describe, expect, it } from "vitest";

// @ts-expect-error The isolated guest runtime is shipped as native ESM JavaScript.
import { missingFactualSectionCitations } from "./wiki-markdown-policy.mjs";

describe("write_wiki Markdown policy", () => {
  it("rejects factual H2 sections without a source marker", () => {
    expect(missingFactualSectionCitations("# Wiki\n\n## Overview\nA fact.\n\n## Architecture\nSupported. [S1]")).toEqual(["Overview"]);
  });

  it("allows limitations and navigation sections without a marker", () => {
    expect(missingFactualSectionCitations("# Wiki\n\n## Navigation\n- Page\n\n## Limitations and uncovered areas\nNot inspected.")).toEqual([]);
  });
});
