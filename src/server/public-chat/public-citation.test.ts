import { describe, expect, it } from "vitest";

import { projectPublicCitations } from "./public-citation";

const base = {
  chunkId: "11111111-1111-4111-8111-111111111111",
  rank: 1,
  materialId: "22222222-2222-4222-8222-222222222222",
  materialTitle: "career.md",
  materialKind: "file" as const,
  mimeType: "text/markdown",
  externalUrl: null,
};

describe("public Citation projection", () => {
  it("shows a citation_allowed source name without any access address or content", () => {
    const [citation] = projectPublicCitations("candidate-agent", [{ ...base, visibility: "citation_allowed" }]);
    expect(citation).toEqual({
      materialTitle: "career.md",
      access: null,
    });
    expect(JSON.stringify(citation)).not.toMatch(/chunkId|rank|materialId|excerpt|materialKind|mimeType|externalUrl|visibility/);
  });

  it("only gives public_preview sources a format-aware access descriptor", () => {
    expect(projectPublicCitations("candidate-agent", [{ ...base, visibility: "public_preview" }])[0]?.access).toEqual({
      href: `/api/public/agents/candidate-agent/materials/${base.materialId}`,
      mode: "markdown",
    });
    expect(projectPublicCitations("candidate-agent", [{ ...base, materialTitle: "resume.pdf", mimeType: "application/pdf", visibility: "public_preview" }])[0]?.access?.mode).toBe("pdf");
    expect(projectPublicCitations("candidate-agent", [{ ...base, materialKind: "website", externalUrl: "https://example.com/source", visibility: "public_preview" }])[0]?.access).toEqual({
      href: "https://example.com/source",
      mode: "new_tab",
    });
  });

  it("lists a source name once when an answer cites more than one chunk from it", () => {
    expect(projectPublicCitations("candidate-agent", [
      { ...base, visibility: "citation_allowed" },
      { ...base, chunkId: "33333333-3333-4333-8333-333333333333", rank: 2, visibility: "citation_allowed" },
    ])).toHaveLength(1);
  });
});
