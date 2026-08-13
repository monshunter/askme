import { createHash } from "node:crypto";

export function sourceLines(source) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  return lines.length > 0 ? lines : [""];
}

export function boundedCitationRanges(lines, lineStart, lineEnd, maxRangeLines = 200) {
  if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart < 1 || lineEnd < lineStart || lineEnd > lines.length) throw new Error("invalid Citation range");
  const ranges = [];
  for (let start = lineStart; start <= lineEnd; start += maxRangeLines) {
    const end = Math.min(lineEnd, start + maxRangeLines - 1);
    ranges.push({
      lineStart: start,
      lineEnd: end,
      contentHash: createHash("sha256").update(lines.slice(start - 1, end).join("\n")).digest("hex"),
    });
  }
  return ranges;
}
