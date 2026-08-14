import { describe, expect, it } from "vitest";

import { answerCitationCount } from "./message-evidence";

describe("answerCitationCount", () => {
  it("counts one logical document source across chunks and duplicate Material rows", () => {
    const base = {
      materialTitle: "SPEC.md",
      materialKind: "file" as const,
      externalUrl: null,
      visibility: "agent_only" as const,
      contentChecksum: "same-content",
      score: 0.9,
    };
    expect(answerCitationCount([
      { ...base, chunkId: "chunk-1", materialId: "material-1", position: 3, content: "MVP scope" },
      { ...base, chunkId: "chunk-2", materialId: "material-2", position: 4, content: "MVP exclusions" },
    ])).toBe(1);
  });
});
