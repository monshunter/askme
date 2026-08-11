import { z } from "zod";

import { AppError } from "@/server/errors";

const evidenceQuerySchema = z.object({
  query: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(500).regex(/[\p{L}\p{N}]/u)),
  limit: z.number().int().min(1).max(20).default(8),
});

export type EvidenceQuery = z.infer<typeof evidenceQuerySchema>;

const questionBoilerplate = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "please",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "would",
  "you",
  "your",
]);

export function buildEvidenceSearchQuery(question: string) {
  const tokens = question.match(/[\p{L}\p{N}]+/gu) ?? [];
  const meaningful = tokens.filter((token) => !questionBoilerplate.has(token.toLocaleLowerCase("en-US")));
  const source = meaningful.length > 0 ? meaningful : tokens;
  const seen = new Set<string>();
  const unique = source.filter((token) => {
    const normalized = token.toLocaleLowerCase("en-US");
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
  return unique.slice(0, 24).join(" OR ");
}

export function parseEvidenceQuery(input: unknown): EvidenceQuery {
  const parsed = evidenceQuerySchema.safeParse(input);
  if (!parsed.success) throw new AppError("INVALID_EVIDENCE_QUERY", "Ask a question between 1 and 500 characters.", 400);
  return parsed.data;
}
