import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { citationContentHash, validateRepositoryDossierOutput } from "./dossier-output";

const source = "export const answer = 42;\nexport function read() {\n  return answer;\n}\n";
const markdown = [
  "# Example repository wiki",
  "",
  "## Project overview",
  "The repository exposes a small reusable module. [S1]",
  "",
  "## Architecture",
  "The public export is the system entrypoint. [S1]",
  "```mermaid",
  "flowchart LR",
  "  Consumer --> Module",
  "```",
  "",
  "## Module map",
  "`src/index.ts` owns the exported value and reader. [S1]",
  "",
  "## Key workflow",
  "A consumer imports the value and the reader returns it. [S1]",
  "",
  "## Build and operations",
  "The examined source proves the module boundary; build behavior was not executed. [S1]",
  "",
  "## Limitations and uncovered areas",
  "Only one representative source file was examined; no compilation or test run is claimed.",
].join("\n");

function fixture() {
  return {
    output: {
      title: "Example repository wiki",
      summary: "A compact example used to explain the repository as a system.",
      pages: [{ path: "overview.md", title: "Overview", order: 0 }],
      citations: [{
        marker: "S1",
        pagePath: "overview.md",
        path: "src/index.ts",
        lineStart: 1,
        lineEnd: 1,
        contentHash: citationContentHash(source, 1, 1),
      }],
      coverage: {
        analysisMode: "targeted",
        eligibleFileCount: 2,
        examinedFileCount: 1,
        examinedPaths: ["src/index.ts"],
        coveredAreas: ["overview", "architecture", "modules", "workflow", "operations"],
        skipped: [{ reason: "scope", count: 1 }],
      },
    },
    files: new Map([["overview.md", markdown]]),
  };
}

const evidence = {
  eligibleFileCount: 2,
  manifestPaths: new Set(["README.md", "src/index.ts"]),
  sources: new Map([["src/index.ts", source]]),
  artifactSkipped: { binary: 1, default_excluded: 2, custom_excluded: 0, special: 0 },
};

describe("Repository Wiki output validation", () => {
  it("accepts a sandbox-written Wiki bundle only when manifest, coverage, markers and immutable citations agree", () => {
    const { output, files } = fixture();
    const result = validateRepositoryDossierOutput(output, files, evidence, "citation_allowed");

    expect(result.coverage).toMatchObject({ analysisMode: "targeted", eligibleFileCount: 2, examinedFileCount: 1, artifactSkipped: evidence.artifactSkipped });
    expect(result.pages[0]).toMatchObject({ path: "overview.md", title: "Overview", order: 0, markdown: expect.stringContaining("```mermaid") });
    expect(result.citations[0]).toMatchObject({ marker: "S1", pagePath: "overview.md", path: "src/index.ts" });
  });

  it("accepts safe bundle-relative links and repeated source ranges across different Wiki pages", () => {
    const { output, files } = fixture();
    files.set("overview.md", markdown.replace("The repository exposes", "See [details](./guides/details.md).\n\nThe repository exposes"));
    const details = [
      "# Architecture details",
      "",
      "## Additional architecture",
      "The same immutable entrypoint supports this detailed explanation. [S2]",
      "",
      "Return to the [overview](../overview.md).",
      "",
      "This page deliberately reuses the exact source range under a page-local marker because the same source can support multiple parts of a Wiki bundle.",
    ].join("\n");
    files.set("guides/details.md", details);
    output.pages.push({ path: "guides/details.md", title: "Architecture details", order: 1 });
    output.citations.push({ ...output.citations[0]!, marker: "S2", pagePath: "guides/details.md" });

    expect(validateRepositoryDossierOutput(output, files, evidence, "citation_allowed").pages).toHaveLength(2);
  });

  it("canonicalizes unused but valid source Citations out of the persisted Wiki", () => {
    const { output, files } = fixture();
    output.citations.push({ ...output.citations[0]!, marker: "S2" });

    expect(validateRepositoryDossierOutput(output, files, evidence, "citation_allowed").citations).toHaveLength(1);
  });

  it("assigns page-local markers when one valid source marker is reused across Wiki pages", () => {
    const { output, files } = fixture();
    const details = [
      "# Shared evidence details",
      "",
      "## Shared source explanation",
      "The entrypoint supports a second page in the same generated bundle. [S1]",
      "",
      "This page reuses an otherwise valid source marker so the Host can bind a unique page-local marker without inventing new evidence.",
    ].join("\n");
    files.set("details.md", details);
    output.pages.push({ path: "details.md", title: "Shared evidence details", order: 1 });

    const result = validateRepositoryDossierOutput(output, files, evidence, "citation_allowed");
    expect(result.citations).toHaveLength(2);
    expect(result.citations.map((citation) => citation.pagePath)).toEqual(["overview.md", "details.md"]);
    expect(result.pages[1]?.markdown).toContain("[S2]");
  });

  it.each([
    ["missing section Citation", ({ files }: ReturnType<typeof fixture>) => { files.set("overview.md", markdown.replace("The repository exposes a small reusable module. [S1]", "The repository exposes a small reusable module.")); }, "WIKI_SECTION_CITATION_REQUIRED"],
    ["undefined marker", ({ files }: ReturnType<typeof fixture>) => { files.set("overview.md", markdown.replace("[S1]", "[S2]")); }, "WIKI_CITATION_MARKER_INVALID"],
    ["unused Citation", ({ output }: ReturnType<typeof fixture>) => { output.citations[0]!.marker = "S2"; }, "WIKI_CITATION_MARKER_INVALID"],
    ["undeclared file", ({ files }: ReturnType<typeof fixture>) => { files.set("extra.md", markdown); }, "WIKI_FILES_INVALID"],
    ["missing file", ({ files }: ReturnType<typeof fixture>) => { files.delete("overview.md"); }, "WIKI_FILES_INVALID"],
    ["duplicate page order", ({ output }: ReturnType<typeof fixture>) => { output.pages.push({ path: "architecture.md", title: "Architecture", order: 0 }); }, "WIKI_MANIFEST_INVALID"],
    ["missing Mermaid", ({ files }: ReturnType<typeof fixture>) => { files.set("overview.md", markdown.replace("```mermaid", "```text")); }, "WIKI_STRUCTURE_INVALID"],
    ["missing limitation", ({ files }: ReturnType<typeof fixture>) => { files.set("overview.md", markdown.replace("## Limitations and uncovered areas", "## Appendix")); }, "WIKI_STRUCTURE_INVALID"],
    ["dangerous HTML", ({ files }: ReturnType<typeof fixture>) => { files.set("overview.md", markdown + "\n<script>alert(1)</script>"); }, "WIKI_MARKDOWN_UNSAFE"],
    ["unknown source path", ({ output }: ReturnType<typeof fixture>) => { output.citations[0]!.path = "src/missing.ts"; }, "DOSSIER_CITATION_PATH_INVALID"],
    ["invalid line range", ({ output }: ReturnType<typeof fixture>) => { output.citations[0]!.lineEnd = 99; }, "DOSSIER_CITATION_RANGE_INVALID"],
    ["invalid content hash", ({ output }: ReturnType<typeof fixture>) => { output.citations[0]!.contentHash = "f".repeat(64); }, "DOSSIER_CITATION_HASH_INVALID"],
    ["unexamined Citation", ({ output }: ReturnType<typeof fixture>) => { output.coverage.examinedPaths = ["README.md"]; }, "DOSSIER_CITATION_NOT_EXAMINED"],
    ["dishonest eligible count", ({ output }: ReturnType<typeof fixture>) => { output.coverage.eligibleFileCount = 3; }, "DOSSIER_COVERAGE_INVALID"],
    ["dishonest skipped count", ({ output }: ReturnType<typeof fixture>) => { output.coverage.skipped[0]!.count = 0; }, "DOSSIER_COVERAGE_INVALID"],
  ])("rejects %s", (_name, mutate, code) => {
    const value = fixture();
    mutate(value);
    expect(() => validateRepositoryDossierOutput(value.output, value.files, evidence, "citation_allowed")).toThrowError(expect.objectContaining({ code }) as Partial<AppError>);
  });

  it("rejects malformed or oversized model output before domain validation", () => {
    expect(() => validateRepositoryDossierOutput({ claims: [] }, new Map(), evidence, "agent_only")).toThrowError(expect.objectContaining({ code: "DOSSIER_OUTPUT_INVALID" }) as Partial<AppError>);
    const { output, files } = fixture();
    files.set("overview.md", "# Wiki\n" + "x".repeat(1_100_000));
    expect(() => validateRepositoryDossierOutput(output, files, evidence, "citation_allowed")).toThrowError(expect.objectContaining({ code: "WIKI_FILES_TOO_LARGE" }) as Partial<AppError>);
  });
});
