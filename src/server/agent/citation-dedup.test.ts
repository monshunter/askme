import { describe, expect, it } from "vitest";

import { deduplicateDocumentChunks, deduplicateDocumentSources } from "./citation-dedup";

describe("document Citation deduplication", () => {
  it("treats duplicate Material rows with the same content checksum as one source", () => {
    expect(deduplicateDocumentSources([
      { materialId: "material-1", contentChecksum: "same", title: "SPEC.md" },
      { materialId: "material-2", contentChecksum: "same", title: "SPEC.md" },
    ])).toEqual([{ materialId: "material-1", contentChecksum: "same", title: "SPEC.md" }]);
  });

  it("keeps distinct content even when titles match and falls back to Material identity without a checksum", () => {
    expect(deduplicateDocumentSources([
      { materialId: "material-1", contentChecksum: "first", title: "SPEC.md" },
      { materialId: "material-2", contentChecksum: "second", title: "SPEC.md" },
      { materialId: "material-3", contentChecksum: null, title: "SPEC.md" },
      { materialId: "material-3", contentChecksum: null, title: "SPEC.md" },
    ])).toHaveLength(3);
  });

  it("removes duplicate chunks from duplicate uploads without collapsing different source positions", () => {
    expect(deduplicateDocumentChunks([
      { materialId: "material-1", contentChecksum: "same", position: 3 },
      { materialId: "material-2", contentChecksum: "same", position: 3 },
      { materialId: "material-1", contentChecksum: "same", position: 4 },
    ])).toEqual([
      { materialId: "material-1", contentChecksum: "same", position: 3 },
      { materialId: "material-1", contentChecksum: "same", position: 4 },
    ]);
  });
});
