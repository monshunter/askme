import { minimatch } from "minimatch";

import type { RuntimeConfig } from "@/server/config";
import { AppError } from "@/server/errors";
import { deterministicTokenCount } from "@/server/rag/structure-chunker";
import { extractPdfPagesFromBytes } from "@/server/materials/text-extraction";

import { readRepositoryArtifactFiles, readRepositoryArtifactManifest, type RepositoryArtifactDescriptor } from "./artifact-reader";

type Config = RuntimeConfig["rag"]["repositoryDocuments"];
type SkipReason = "not_included" | "excluded" | "markdown_too_large" | "pdf_too_large" | "unsupported_no_extractable_text" | "pdf_invalid" | "revision_token_limit_exceeded";

export type RepositoryDocumentDiscovery = {
  documents: Array<{ path: string; size: number; contentHash: string; kind: "repository_markdown" | "repository_pdf" }>;
  skipped: Array<{ path: string; reason: SkipReason }>;
};

function matches(path: string, patterns: string[]) {
  return patterns.some((pattern) => minimatch(path, pattern, { dot: true, nocase: false }));
}

export async function discoverRepositoryDocuments(root: string, descriptor: RepositoryArtifactDescriptor, config: Config): Promise<RepositoryDocumentDiscovery> {
  const manifest = await readRepositoryArtifactManifest(root, descriptor);
  const documents: RepositoryDocumentDiscovery["documents"] = [];
  const skipped: RepositoryDocumentDiscovery["skipped"] = [];
  for (const file of [...manifest.manifestFiles].sort((left, right) => left.path.localeCompare(right.path))) {
    const extension = file.path.toLowerCase().endsWith(".pdf") ? "pdf" : file.path.toLowerCase().endsWith(".md") ? "md" : null;
    if (!extension || !matches(file.path, config.include)) {
      skipped.push({ path: file.path, reason: "not_included" });
      continue;
    }
    if (matches(file.path, config.exclude)) {
      skipped.push({ path: file.path, reason: "excluded" });
      continue;
    }
    if (extension === "md" && file.size > config.maxMarkdownBytes) {
      skipped.push({ path: file.path, reason: "markdown_too_large" });
      continue;
    }
    if (extension === "pdf" && file.size > config.maxPdfBytes) {
      skipped.push({ path: file.path, reason: "pdf_too_large" });
      continue;
    }
    documents.push({ ...file, kind: extension === "pdf" ? "repository_pdf" : "repository_markdown" });
  }
  return { documents, skipped };
}

export async function collectRepositoryDocuments(root: string, descriptor: RepositoryArtifactDescriptor, config: Config) {
  const discovery = await discoverRepositoryDocuments(root, descriptor, config);
  const artifact = await readRepositoryArtifactFiles(root, descriptor, discovery.documents.map((document) => document.path));
  const documents: Array<{
    path: string; kind: "repository_markdown" | "repository_pdf"; text: string; contentHash: string; sourceRevision: string; tokenCount: number; pageCount: number | null;
  }> = [];
  const skipped = [...discovery.skipped];
  let revisionTokens = 0;
  for (const discovered of discovery.documents) {
    const bytes = artifact.files.get(discovered.path);
    if (!bytes) throw new AppError("REPOSITORY_ARTIFACT_SOURCE_NOT_FOUND", "A Repository document is absent from the immutable Artifact.", 422);
    let text: string;
    let pageCount: number | null = null;
    if (discovered.kind === "repository_pdf") {
      try {
        const pages = await extractPdfPagesFromBytes(bytes);
        if (pages.length > config.maxPdfPages) {
          skipped.push({ path: discovered.path, reason: "pdf_too_large" });
          continue;
        }
        pageCount = pages.length;
        text = pages.map((page) => `# Page ${page.pageNumber}\n\n${page.text}`).join("\n\n");
      } catch (error) {
        skipped.push({ path: discovered.path, reason: error instanceof AppError && error.code === "MATERIAL_TEXT_EMPTY" ? "unsupported_no_extractable_text" : "pdf_invalid" });
        continue;
      }
    } else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        skipped.push({ path: discovered.path, reason: "pdf_invalid" });
        continue;
      }
    }
    const tokenCount = deterministicTokenCount(text);
    if (revisionTokens + tokenCount > config.maxRevisionTokens) {
      skipped.push({ path: discovered.path, reason: "revision_token_limit_exceeded" });
      continue;
    }
    revisionTokens += tokenCount;
    documents.push({ path: discovered.path, kind: discovered.kind, text, contentHash: discovered.contentHash, sourceRevision: `${descriptor.commitSha}:${discovered.path}:${discovered.contentHash}`, tokenCount, pageCount });
  }
  const warnings = skipped.filter((entry) => entry.reason !== "not_included" && entry.reason !== "excluded");
  return { state: warnings.length > 0 ? "ready_with_warnings" as const : "ready" as const, documents, skipped, tokenCount: revisionTokens };
}

export async function collectRepositoryDocument(root: string, descriptor: RepositoryArtifactDescriptor, config: Config, documentPath: string) {
  const discovery = await discoverRepositoryDocuments(root, descriptor, config);
  const discovered = discovery.documents.find((document) => document.path === documentPath);
  if (!discovered) throw new AppError("REPOSITORY_DOCUMENT_NOT_ELIGIBLE", "The Repository document is not eligible for indexing.", 422);
  const artifact = await readRepositoryArtifactFiles(root, descriptor, [documentPath]);
  const bytes = artifact.files.get(documentPath);
  if (!bytes) throw new AppError("REPOSITORY_ARTIFACT_SOURCE_NOT_FOUND", "A Repository document is absent from the immutable Artifact.", 422);
  if (discovered.kind === "repository_pdf") {
    const pages = await extractPdfPagesFromBytes(bytes);
    if (pages.length > config.maxPdfPages) throw new AppError("REPOSITORY_PDF_PAGE_LIMIT", "The Repository PDF exceeds the configured page limit.", 422);
    const text = pages.map((page) => `# Page ${page.pageNumber}\n\n${page.text}`).join("\n\n");
    return { ...discovered, text, pageCount: pages.length, tokenCount: deterministicTokenCount(text), sourceRevision: `${descriptor.commitSha}:${discovered.path}:${discovered.contentHash}` };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AppError("REPOSITORY_DOCUMENT_TEXT_INVALID", "The Repository Markdown document is not valid UTF-8 text.", 422);
  }
  return { ...discovered, text, pageCount: null, tokenCount: deterministicTokenCount(text), sourceRevision: `${descriptor.commitSha}:${discovered.path}:${discovered.contentHash}` };
}
