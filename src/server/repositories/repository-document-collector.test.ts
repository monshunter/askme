import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfigFromSources } from "@/server/config";

import { FileSystemRepositoryArtifactStore } from "./artifact-store";
import { collectRepositoryDocuments, discoverRepositoryDocuments } from "./repository-document-collector";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function minimalPdf(text: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length + 33} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(source)); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return source;
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "askme-repository-doc-test-"));
  roots.push(root);
  const zip = new JSZip();
  zip.file("repository-root/README.md", "# Atlas\n\nRepository overview.\n");
  zip.file("repository-root/docs/guide.md", "# Guide\n\nDeployment evidence.\n");
  zip.file("repository-root/docs/architecture.pdf", minimalPdf("Repository PDF Evidence"));
  zip.file("repository-root/src/index.ts", "export const ignored = true;\n");
  const archive = new Uint8Array(await zip.generateAsync({ type: "uint8array", platform: "UNIX" }));
  const stored = await new FileSystemRepositoryArtifactStore(root).store({
    ownerId: "owner",
    canonicalUrl: "https://github.com/org/atlas",
    commitSha: "a".repeat(40),
    archive,
    archiveChecksum: createHash("sha256").update(archive).digest("hex"),
    excludePatterns: [],
  });
  return { root, descriptor: { contentKey: stored.contentKey, checksum: stored.checksum, manifestChecksum: stored.manifestChecksum, storagePath: stored.storagePath, canonicalUrl: "https://github.com/org/atlas", commitSha: "a".repeat(40), filterFingerprint: stored.filterFingerprint, fileCount: stored.fileCount } };
}

describe("Repository document collector", () => {
  it("discovers only configured Markdown/PDF paths and retains stable skip reasons", async () => {
    const { root, descriptor } = await fixture();
    const config = loadConfigFromSources({}, "").rag.repositoryDocuments;
    const discovery = await discoverRepositoryDocuments(root, descriptor, config);

    expect(discovery.documents.map((document) => document.path)).toEqual(["docs/architecture.pdf", "docs/guide.md", "README.md"]);
    expect(discovery.skipped).toContainEqual({ path: "src/index.ts", reason: "not_included" });
  });

  it("extracts Markdown lines and PDF pages from the immutable commit", async () => {
    const { root, descriptor } = await fixture();
    const config = loadConfigFromSources({}, "").rag.repositoryDocuments;
    const result = await collectRepositoryDocuments(root, descriptor, config);

    expect(result.state).toBe("ready");
    expect(result.documents.find((document) => document.path === "README.md")).toMatchObject({ kind: "repository_markdown", text: expect.stringContaining("Repository overview") });
    expect(result.documents.find((document) => document.path.endsWith(".pdf"))).toMatchObject({ kind: "repository_pdf", text: expect.stringContaining("Repository PDF Evidence"), pageCount: 1 });
    expect(result.documents.every((document) => document.sourceRevision.startsWith(`${"a".repeat(40)}:`))).toBe(true);
  });

  it("reports capacity skips instead of truncating or silently dropping documents", async () => {
    const { root, descriptor } = await fixture();
    const config = { ...loadConfigFromSources({}, "").rag.repositoryDocuments, maxMarkdownBytes: 10 };
    const result = await collectRepositoryDocuments(root, descriptor, config);

    expect(result.state).toBe("ready_with_warnings");
    expect(result.skipped).toEqual(expect.arrayContaining([
      { path: "README.md", reason: "markdown_too_large" },
      { path: "docs/guide.md", reason: "markdown_too_large" },
    ]));
  });
});
