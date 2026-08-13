import { createHash } from "node:crypto";
import path from "node:path";

import { z } from "zod";

import { AppError } from "@/server/errors";

import type { RepositoryVisibility } from "./repository-sync";

const MAX_DOSSIER_OUTPUT_BYTES = 256 * 1024;
export const MAX_WIKI_BUNDLE_BYTES = 1024 * 1024;
export const MAX_WIKI_PAGE_BYTES = 500_000;
export const MAX_WIKI_FILES = 32;
const wikiPathPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}\.md$/;
function isSafeWikiPath(value: string) {
  return wikiPathPattern.test(value)
    && !value.split("/").some((part) => part === "." || part === ".." || part.startsWith("."));
}
const pageSchema = z.object({
  path: z.string().refine(isSafeWikiPath),
  title: z.string().trim().min(1).max(300),
  order: z.number().int().nonnegative().max(31),
}).strict();
const citationSchema = z.object({
  marker: z.string().regex(/^S[1-9][0-9]{0,3}$/),
  pagePath: z.string().refine(isSafeWikiPath),
  path: z.string().trim().min(1).max(1_024),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
const coverageSchema = z.object({
  analysisMode: z.enum(["targeted", "broad"]),
  eligibleFileCount: z.number().int().positive(),
  examinedFileCount: z.number().int().nonnegative(),
  examinedPaths: z.array(z.string().trim().min(1).max(1_024)).max(10_000),
  coveredAreas: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
  skipped: z.array(z.object({
    reason: z.enum(["scope", "budget", "tool_limit", "unreadable", "other"]),
    count: z.number().int().nonnegative(),
  }).strict()).max(5),
}).strict();
const dossierOutputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(4_000),
  pages: z.array(pageSchema).min(1).max(MAX_WIKI_FILES),
  citations: z.array(citationSchema).min(1).max(400),
  coverage: coverageSchema,
}).strict();

export type RepositoryDossierOutput = z.infer<typeof dossierOutputSchema>;
export type RepositoryWikiCitation = RepositoryDossierOutput["citations"][number];
export type RepositoryWikiPage = RepositoryDossierOutput["pages"][number] & { markdown: string };
export type DossierArtifactEvidence = {
  eligibleFileCount: number;
  manifestPaths: Set<string>;
  sources: Map<string, string>;
  artifactSkipped: { binary: number; default_excluded: number; custom_excluded: number; special: number };
};
export type ValidatedRepositoryDossier = Omit<RepositoryDossierOutput, "pages"> & {
  pages: RepositoryWikiPage[];
  coverage: RepositoryDossierOutput["coverage"] & { artifactSkipped: DossierArtifactEvidence["artifactSkipped"] };
};

function sourceLines(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  return lines.length > 0 ? lines : [""];
}

export function citationContentHash(source: string, lineStart: number, lineEnd: number) {
  const lines = sourceLines(source);
  if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart < 1 || lineEnd < lineStart || lineEnd - lineStart + 1 > 200 || lineEnd > lines.length) {
    throw new AppError("DOSSIER_CITATION_RANGE_INVALID", "A Repository Wiki Citation line range is invalid.", 422);
  }
  return createHash("sha256").update(lines.slice(lineStart - 1, lineEnd).join("\n")).digest("hex");
}

export function parseRepositoryDossierOutput(input: unknown) {
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new AppError("DOSSIER_OUTPUT_INVALID", "The Repository analysis output is not valid structured data.", 422);
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_DOSSIER_OUTPUT_BYTES) {
    throw new AppError("DOSSIER_OUTPUT_TOO_LARGE", "The Repository Wiki manifest exceeds the configured limit.", 413);
  }
  const parsed = dossierOutputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("DOSSIER_OUTPUT_INVALID", "The Repository analysis output does not match the Wiki manifest schema.", 422, {
      fields: [...new Set(parsed.error.issues.map((issue) => issue.path[0]).filter((value): value is string => typeof value === "string"))],
    });
  }
  return parsed.data;
}

type WikiSection = { heading: string; body: string };

export function repositoryWikiSections(markdown: string): WikiSection[] {
  const headings = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  return headings.map((heading, index) => ({
    heading: heading[1]!.trim(),
    body: markdown.slice((heading.index ?? 0) + heading[0].length, headings[index + 1]?.index ?? markdown.length).trim(),
  }));
}

export function repositoryWikiMarkers(markdown: string) {
  return [...markdown.matchAll(/\[(S[1-9][0-9]{0,3})\]/g)].map((match) => match[1]!);
}

function isNonFactualHeading(heading: string) {
  return /limitations?|known limits?|uncovered|uncertaint|sources?|references?|contents?|navigation|how to read|源码引用|限制|未覆盖|不确定|目录|导航|阅读指南/i.test(heading);
}

function validatePageLinks(markdown: string, pagePath: string, declaredPaths: Set<string>) {
  for (const match of markdown.matchAll(/\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
    const target = match[1]!;
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    const clean = target.split("#", 1)[0]!;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(pagePath), clean));
    if (!isSafeWikiPath(resolved) || !declaredPaths.has(resolved)) {
      throw new AppError("WIKI_LINK_INVALID", "The Repository Wiki contains a link outside its generated bundle.", 422);
    }
  }
}

export function validateRepositoryWikiBundle(
  pages: RepositoryWikiPage[],
  citations: RepositoryWikiCitation[],
) {
  const declaredPaths = new Set(pages.map((page) => page.path));
  const markerOwner = new Map(citations.map((citation) => [citation.marker, citation.pagePath]));
  const allMarkers = new Set(citations.map((citation) => citation.marker));
  let sectionCount = 0;
  let hasMermaid = false;
  let hasLimitations = false;
  const usedMarkers = new Set<string>();

  const sectionsByPage = new Map<string, WikiSection[]>();
  for (const page of pages) {
    if (/<\s*(?:script|iframe|object|embed|svg|style|link|meta|form)\b|\bon[a-z]+\s*=|javascript\s*:/i.test(page.markdown)) {
      throw new AppError("WIKI_MARKDOWN_UNSAFE", "The Repository Wiki Markdown contains unsafe executable content.", 422);
    }
    if (!/^#\s+\S.+$/m.test(page.markdown)) throw new AppError("WIKI_STRUCTURE_INVALID", "Each Repository Wiki page requires a title.", 422);
    const sections = repositoryWikiSections(page.markdown);
    sectionsByPage.set(page.path, sections);
    if (sections.length === 0) throw new AppError("WIKI_STRUCTURE_INVALID", "Each Repository Wiki page requires a substantive section.", 422);
    sectionCount += sections.length;
    hasMermaid ||= /```mermaid\s*[\s\S]+?```/i.test(page.markdown);
    hasLimitations ||= sections.some((section) => /limitations?|known limits?|uncovered|uncertaint|限制|未覆盖|不确定/i.test(section.heading));
    validatePageLinks(page.markdown, page.path, declaredPaths);
    for (const marker of repositoryWikiMarkers(page.markdown)) {
      if (!allMarkers.has(marker) || markerOwner.get(marker) !== page.path) throw new AppError("WIKI_CITATION_MARKER_INVALID", "A Repository Wiki marker is undefined or bound to another page.", 422);
      usedMarkers.add(marker);
    }
  }
  if (sectionCount < 5 || !hasMermaid || !hasLimitations) {
    throw new AppError("WIKI_STRUCTURE_INVALID", "The Repository Wiki bundle is missing its required document structure.", 422);
  }
  for (const page of pages) {
    for (const section of sectionsByPage.get(page.path) ?? []) {
      if (!isNonFactualHeading(section.heading) && repositoryWikiMarkers(section.body).length === 0) {
        throw new AppError("WIKI_SECTION_CITATION_REQUIRED", "Every factual Repository Wiki section requires a source Citation.", 422);
      }
    }
  }
  if (usedMarkers.size !== allMarkers.size) throw new AppError("WIKI_CITATION_MARKER_INVALID", "The Repository Wiki contains an unused source Citation.", 422);
  return { sectionCount, usedMarkers: [...usedMarkers] };
}

function resolveWikiPages(output: RepositoryDossierOutput, wikiFiles: ReadonlyMap<string, string>) {
  const pagePaths = new Set(output.pages.map((page) => page.path));
  const titleSet = new Set(output.pages.map((page) => page.title));
  const orderSet = new Set(output.pages.map((page) => page.order));
  if (pagePaths.size !== output.pages.length || titleSet.size !== output.pages.length || orderSet.size !== output.pages.length
    || output.pages.some((page, index) => page.order !== index)) {
    throw new AppError("WIKI_MANIFEST_INVALID", "The Repository Wiki page manifest is inconsistent.", 422);
  }
  if (wikiFiles.size !== output.pages.length || [...wikiFiles.keys()].some((file) => !pagePaths.has(file))) {
    throw new AppError("WIKI_FILES_INVALID", "The Repository Wiki files do not match their manifest.", 422);
  }
  let totalBytes = 0;
  const pages = output.pages.map((page) => {
    const markdown = wikiFiles.get(page.path);
    if (markdown === undefined) throw new AppError("WIKI_FILES_INVALID", "A Repository Wiki file is missing.", 422);
    const bytes = Buffer.byteLength(markdown, "utf8");
    totalBytes += bytes;
    if (bytes < 200 || bytes > MAX_WIKI_PAGE_BYTES) throw new AppError("WIKI_FILES_TOO_LARGE", "A Repository Wiki page is outside its size limit.", 413);
    return { ...page, markdown: markdown.trim() };
  });
  if (totalBytes > MAX_WIKI_BUNDLE_BYTES) throw new AppError("WIKI_FILES_TOO_LARGE", "The Repository Wiki bundle exceeds its size limit.", 413);
  return pages;
}

function canonicalizeWikiCitations(inputPages: RepositoryWikiPage[], inputCitations: RepositoryWikiCitation[]) {
  const pages = inputPages.map((page) => ({ ...page }));
  const markerNumbers = [
    ...inputCitations.map((citation) => Number(citation.marker.slice(1))),
    ...pages.flatMap((page) => repositoryWikiMarkers(page.markdown).map((marker) => Number(marker.slice(1)))),
  ].filter(Number.isFinite);
  let nextMarker = Math.max(0, ...markerNumbers) + 1;
  const allocateMarker = () => {
    if (nextMarker > 9_999) throw new AppError("WIKI_CITATION_MARKER_INVALID", "The Repository Wiki requires too many Citation markers.", 422);
    return `S${nextMarker++}`;
  };
  const pagePathsForMarker = (marker: string) => pages
    .filter((page) => repositoryWikiMarkers(page.markdown).includes(marker))
    .map((page) => page.path);
  const replaceMarker = (pagePath: string, marker: string, replacement: string) => {
    const page = pages.find((candidate) => candidate.path === pagePath)!;
    page.markdown = page.markdown.replaceAll(`[${marker}]`, replacement);
  };

  const grouped = new Map<string, RepositoryWikiCitation[]>();
  for (const citation of inputCitations) grouped.set(citation.marker, [...(grouped.get(citation.marker) ?? []), citation]);
  const unique: RepositoryWikiCitation[] = [];
  for (const [marker, group] of grouped) {
    const markerPages = pagePathsForMarker(marker);
    if (markerPages.length === 0) continue;
    for (const [index, citation] of group.entries()) {
      const owner = markerPages.includes(citation.pagePath) ? citation.pagePath : markerPages[0]!;
      if (index === 0) {
        unique.push({ ...citation, pagePath: owner });
        continue;
      }
      const newMarker = allocateMarker();
      replaceMarker(owner, marker, `[${marker}] [${newMarker}]`);
      unique.push({ ...citation, marker: newMarker, pagePath: owner });
    }
  }

  const citations: RepositoryWikiCitation[] = [];
  for (const citation of unique) {
    const markerPages = pagePathsForMarker(citation.marker);
    if (markerPages.length === 0) continue;
    const owner = markerPages.includes(citation.pagePath) ? citation.pagePath : markerPages[0]!;
    citations.push({ ...citation, pagePath: owner });
    for (const extraPage of markerPages.filter((pagePath) => pagePath !== owner)) {
      const newMarker = allocateMarker();
      replaceMarker(extraPage, citation.marker, `[${newMarker}]`);
      citations.push({ ...citation, marker: newMarker, pagePath: extraPage });
    }
  }
  if (citations.length > 400) throw new AppError("WIKI_CITATION_MARKER_INVALID", "The Repository Wiki has too many normalized Citation markers.", 422);
  return { pages, citations };
}

export function validateRepositoryDossierOutput(
  input: unknown,
  wikiFiles: ReadonlyMap<string, string>,
  evidence: DossierArtifactEvidence,
  repositoryVisibility: RepositoryVisibility,
): ValidatedRepositoryDossier {
  const output = parseRepositoryDossierOutput(input);
  if (repositoryVisibility === "private") throw new AppError("DOSSIER_REPOSITORY_PRIVATE", "A private Repository cannot generate a Wiki.", 409);

  const examinedPaths = new Set(output.coverage.examinedPaths);
  const skipReasons = new Set(output.coverage.skipped.map((item) => item.reason));
  const skippedCount = output.coverage.skipped.reduce((sum, item) => sum + item.count, 0);
  if (
    output.coverage.eligibleFileCount !== evidence.eligibleFileCount
    || output.coverage.examinedFileCount !== output.coverage.examinedPaths.length
    || examinedPaths.size !== output.coverage.examinedPaths.length
    || skipReasons.size !== output.coverage.skipped.length
    || skippedCount !== evidence.eligibleFileCount - output.coverage.examinedFileCount
    || output.coverage.examinedFileCount > evidence.eligibleFileCount
    || output.coverage.examinedPaths.some((path) => !evidence.manifestPaths.has(path))
  ) throw new AppError("DOSSIER_COVERAGE_INVALID", "The Repository Wiki coverage does not match the immutable Repository Artifact.", 422);

  const normalized = canonicalizeWikiCitations(resolveWikiPages(output, wikiFiles), output.citations);
  const { pages, citations } = normalized;
  const markers = new Set(citations.map((citation) => citation.marker));
  const pagePaths = new Set(output.pages.map((page) => page.path));
  if (markers.size !== citations.length || citations.some((citation) => !pagePaths.has(citation.pagePath))) {
    throw new AppError("WIKI_CITATION_MARKER_INVALID", "Repository Wiki Citation markers must be unique and bind a declared page.", 422);
  }
  validateRepositoryWikiBundle(pages, citations);

  for (const citation of citations) {
    if (Buffer.byteLength(citation.path, "utf8") > 1_024 || !evidence.manifestPaths.has(citation.path)) throw new AppError("DOSSIER_CITATION_PATH_INVALID", "A Repository Wiki Citation path is not present in the immutable Repository Artifact.", 422);
    if (!examinedPaths.has(citation.path)) throw new AppError("DOSSIER_CITATION_NOT_EXAMINED", "A Repository Wiki Citation must refer to an examined source path.", 422);
    const source = evidence.sources.get(citation.path);
    if (source === undefined) throw new AppError("DOSSIER_CITATION_SOURCE_UNAVAILABLE", "A cited Repository source could not be validated.", 422);
    if (citation.contentHash !== citationContentHash(source, citation.lineStart, citation.lineEnd)) throw new AppError("DOSSIER_CITATION_HASH_INVALID", "A Repository Wiki Citation does not match the immutable Repository source.", 422);
  }

  return { ...output, pages, citations, coverage: { ...output.coverage, artifactSkipped: evidence.artifactSkipped } };
}
