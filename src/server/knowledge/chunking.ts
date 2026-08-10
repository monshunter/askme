import { AppError } from "@/server/errors";

export type EvidenceChunk = { position: number; content: string; tokenEstimate: number };

const MAX_SOURCE_CHARACTERS = 2_000_000;
const MAX_CHUNKS = 2_000;

export function chunkMaterialText(text: string, targetCharacters = 1_200, overlapCharacters = 160): EvidenceChunk[] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) throw new AppError("MATERIAL_TEXT_EMPTY", "The material does not contain extractable text.", 422);
  if (normalized.length > MAX_SOURCE_CHARACTERS) {
    throw new AppError("MATERIAL_TEXT_TOO_LARGE", "The extracted material is too large to organize safely.", 413);
  }
  if (targetCharacters < 400 || overlapCharacters < 0 || overlapCharacters >= targetCharacters / 2) {
    throw new AppError("INVALID_CHUNK_CONFIGURATION", "The evidence chunk configuration is invalid.", 500);
  }

  const chunks: EvidenceChunk[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + targetCharacters, normalized.length);
    if (end < normalized.length) {
      const preferred = Math.max(normalized.lastIndexOf("\n\n", end), normalized.lastIndexOf(". ", end), normalized.lastIndexOf("\n", end), normalized.lastIndexOf(" ", end));
      if (preferred > start + targetCharacters * 0.6) end = preferred + (normalized.slice(preferred, preferred + 2) === ". " ? 1 : 0);
    }
    const content = normalized.slice(start, end).trim();
    if (content) chunks.push({ position: chunks.length, content, tokenEstimate: Math.max(1, Math.ceil(content.length / 4)) });
    if (chunks.length > MAX_CHUNKS) throw new AppError("MATERIAL_CHUNK_LIMIT", "The material produced too many evidence chunks.", 413);
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlapCharacters);
  }
  return chunks;
}

export function organizationContext(chunks: EvidenceChunk[], maxCharacters = 60_000) {
  const separator = "\n\n--- evidence chunk ---\n\n";
  const formatChunk = (chunk: EvidenceChunk) => `[Evidence chunk ${chunk.position}]\n${chunk.content}`;
  const full = chunks.map(formatChunk).join(separator);
  if (full.length <= maxCharacters) return full;
  const selected: string[] = [];
  const count = Math.max(2, Math.floor(maxCharacters / 2_000));
  for (let index = 0; index < count; index += 1) {
    const chunk = chunks[Math.round((index * (chunks.length - 1)) / (count - 1))];
    if (chunk) {
      const formatted = formatChunk(chunk);
      if (!selected.includes(formatted)) selected.push(formatted);
    }
  }
  return selected.join(separator).slice(0, maxCharacters);
}
