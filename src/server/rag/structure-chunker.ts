import { createHash } from "node:crypto";

import type { RuntimeConfig } from "@/server/config";
import { AppError } from "@/server/errors";

type ChunkingConfig = RuntimeConfig["rag"]["chunking"];
type SourceRange = { lineStart: number; lineEnd: number; forcedSplit?: boolean };

export type RagParentChunk = {
  stableKey: string;
  position: number;
  content: string;
  tokenCount: number;
  structurePath: string;
  sourceRange: SourceRange;
  contentChecksum: string;
};

export type RagChildChunk = {
  stableKey: string;
  parentStableKey: string;
  position: number;
  content: string;
  contextualContent: string;
  tokenCount: number;
  sourceRange: SourceRange;
  contentChecksum: string;
};

type Unit = { text: string; path: string; lineStart: number; lineEnd: number; forcedSplit?: boolean };
type Token = { start: number; end: number };

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeText(value: string) {
  return value.normalize("NFKC").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[\t ]+/g, " ").trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function tokens(value: string): Token[] {
  const result: Token[] = [];
  const pattern = /\p{Script=Han}|[\p{L}\p{N}_-]+|[^\s]/gu;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    result.push({ start, end: start + match[0].length });
  }
  return result;
}

export function deterministicTokenCount(value: string) {
  return tokens(value).length;
}

function lineRange(value: string, startOffset: number, endOffset: number, baseLine: number) {
  const lineStart = baseLine + value.slice(0, startOffset).split("\n").length - 1;
  const lineEnd = baseLine + value.slice(0, endOffset).split("\n").length - 1;
  return { lineStart, lineEnd };
}

function splitTokenWindow(unit: Unit, maxTokens: number, overlapTokens: number): Unit[] {
  const indexed = tokens(unit.text);
  if (indexed.length <= maxTokens) return [unit];
  const output: Unit[] = [];
  let tokenStart = 0;
  while (tokenStart < indexed.length) {
    const tokenEnd = Math.min(indexed.length, tokenStart + maxTokens);
    const startOffset = indexed[tokenStart]?.start ?? 0;
    const endOffset = indexed[tokenEnd - 1]?.end ?? unit.text.length;
    const range = lineRange(unit.text, startOffset, endOffset, unit.lineStart);
    output.push({ text: unit.text.slice(startOffset, endOffset).trim(), path: `${unit.path} / part ${output.length + 1}`, ...range, forcedSplit: true });
    if (tokenEnd >= indexed.length) break;
    tokenStart = Math.max(tokenStart + 1, tokenEnd - overlapTokens);
  }
  return output;
}

function structuralUnits(text: string): Unit[] {
  const lines = text.split("\n");
  const headings: string[] = [];
  const units: Unit[] = [];
  let start = 0;
  let path = "Document";

  const flush = (endExclusive: number) => {
    const content = lines.slice(start, endExclusive).join("\n").trim();
    if (content) units.push({ text: content, path, lineStart: start + 1, lineEnd: endExclusive });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index] ?? "");
    if (!heading) continue;
    if (index > start) flush(index);
    const level = heading[1]!.length;
    headings.splice(level - 1);
    headings[level - 1] = heading[2]!.trim();
    path = headings.filter(Boolean).join(" / ");
    start = index;
  }
  flush(lines.length);
  return units.length > 0 ? units : [{ text, path: "Document", lineStart: 1, lineEnd: lines.length }];
}

function buildParents(units: Unit[], config: ChunkingConfig) {
  const bounded = units.flatMap((unit) => splitTokenWindow(unit, config.parentMaxTokens, config.overlapTokens));
  const groups: Unit[][] = [];
  let current: Unit[] = [];
  let currentTokens = 0;
  for (const unit of bounded) {
    const count = deterministicTokenCount(unit.text);
    if (current.length > 0 && currentTokens + count > config.parentMaxTokens) {
      groups.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(unit);
    currentTokens += count;
    if (currentTokens >= config.parentMinTokens) {
      groups.push(current);
      current = [];
      currentTokens = 0;
    }
  }
  if (current.length > 0) {
    const previous = groups.at(-1);
    const combined = previous ? deterministicTokenCount([...previous, ...current].map((unit) => unit.text).join("\n\n")) : Number.POSITIVE_INFINITY;
    if (previous && combined <= config.parentMaxTokens) previous.push(...current);
    else groups.push(current);
  }
  return groups;
}

function paragraphUnits(parent: RagParentChunk): Unit[] {
  const output: Unit[] = [];
  let offset = 0;
  for (const part of parent.content.split(/\n{2,}/)) {
    const startOffset = parent.content.indexOf(part, offset);
    const endOffset = startOffset + part.length;
    offset = endOffset;
    const range = lineRange(parent.content, startOffset, endOffset, parent.sourceRange.lineStart);
    if (part.trim()) output.push({ text: part.trim(), path: parent.structurePath, ...range });
  }
  return output;
}

function childUnits(parent: RagParentChunk, config: ChunkingConfig) {
  const bounded = paragraphUnits(parent).flatMap((unit) => splitTokenWindow(unit, config.childTargetTokens, config.overlapTokens));
  const groups: Unit[][] = [];
  let current: Unit[] = [];
  let currentTokens = 0;
  for (const unit of bounded) {
    const count = deterministicTokenCount(unit.text);
    if (current.length > 0 && currentTokens + count > config.childHardMaxTokens) {
      groups.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(unit);
    currentTokens += count;
    if (currentTokens >= config.childTargetTokens) {
      groups.push(current);
      current = [];
      currentTokens = 0;
    }
  }
  if (current.length > 0) {
    const previous = groups.at(-1);
    const combined = previous ? deterministicTokenCount([...previous, ...current].map((unit) => unit.text).join("\n\n")) : Number.POSITIVE_INFINITY;
    if (previous && currentTokens < config.childMinTokens && combined <= config.childHardMaxTokens) previous.push(...current);
    else groups.push(current);
  }
  return groups;
}

export function structureChunkText(input: { text: string; sourceRevision: string; sourceTitle: string; entityLabels?: string[]; config: ChunkingConfig }) {
  const text = normalizeText(input.text);
  if (!text) throw new AppError("RAG_SOURCE_TEXT_EMPTY", "The RAG source does not contain extractable text.", 422);
  if (!input.sourceRevision.trim() || !input.sourceTitle.trim()) throw new AppError("RAG_SOURCE_IDENTITY_INVALID", "The RAG source identity is invalid.", 500);
  const entityLabels = [...new Set((input.entityLabels ?? []).map((label) => label.normalize("NFKC").replace(/\s+/gu, " ").trim()).filter(Boolean))].slice(0, 20);
  const entityContext = entityLabels.length > 0 ? `Entities: ${entityLabels.join(" | ")}\n` : "";

  const parents: RagParentChunk[] = buildParents(structuralUnits(text), input.config).map((group, position) => {
    const content = group.map((unit) => unit.text).join("\n\n");
    const structurePath = [...new Set(group.map((unit) => unit.path))].join(" + ");
    const sourceRange = { lineStart: Math.min(...group.map((unit) => unit.lineStart)), lineEnd: Math.max(...group.map((unit) => unit.lineEnd)), ...(group.some((unit) => unit.forcedSplit) ? { forcedSplit: true } : {}) };
    const contentChecksum = sha256(content);
    const stableKey = sha256(`${input.sourceRevision}\n${structurePath}\n${JSON.stringify(sourceRange)}\n${contentChecksum}`);
    return { stableKey, position, content, tokenCount: deterministicTokenCount(content), structurePath, sourceRange, contentChecksum };
  });

  const children: RagChildChunk[] = [];
  for (const parent of parents) {
    for (const group of childUnits(parent, input.config)) {
      const content = group.map((unit) => unit.text).join("\n\n");
      const sourceRange = { lineStart: Math.min(...group.map((unit) => unit.lineStart)), lineEnd: Math.max(...group.map((unit) => unit.lineEnd)), ...(group.some((unit) => unit.forcedSplit) ? { forcedSplit: true } : {}) };
      const contentChecksum = sha256(content);
      const stableKey = sha256(`${input.sourceRevision}\n${parent.structurePath}\n${JSON.stringify(sourceRange)}\n${contentChecksum}`);
      children.push({
        stableKey,
        parentStableKey: parent.stableKey,
        position: children.length,
        content,
        contextualContent: `Source: ${input.sourceTitle}\n${entityContext}Section: ${parent.structurePath}\n\n${content}`,
        tokenCount: deterministicTokenCount(content),
        sourceRange,
        contentChecksum,
      });
    }
  }
  return { parents, children, tokenCount: parents.reduce((total, parent) => total + parent.tokenCount, 0) };
}
