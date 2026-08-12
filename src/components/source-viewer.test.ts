import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sourceOpenMode } from "./source-viewer";

const viewerSource = readFileSync(new URL("./source-viewer.tsx", import.meta.url), "utf8");

describe("sourceOpenMode", () => {
  it("previews Markdown and PDF files in-page", () => {
    expect(sourceOpenMode({ kind: "file", title: "SPEC.md", mimeType: "text/plain" })).toBe("markdown");
    expect(sourceOpenMode({ kind: "file", title: "resume.bin", mimeType: "application/pdf" })).toBe("pdf");
  });

  it("opens Office, text, and remote sources in a new tab", () => {
    expect(sourceOpenMode({ kind: "file", title: "resume.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe("new_tab");
    expect(sourceOpenMode({ kind: "file", title: "notes.txt", mimeType: "text/plain" })).toBe("new_tab");
    expect(sourceOpenMode({ kind: "website", title: "Article.md", mimeType: "text/markdown" })).toBe("new_tab");
  });

  it("portals modal content outside source lists so Markdown keeps its own layout", () => {
    expect(viewerSource).toContain("createPortal");
    expect(viewerSource).toContain("document.body");
  });
});
