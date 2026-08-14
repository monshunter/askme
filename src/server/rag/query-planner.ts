import { z } from "zod";

import type { AnswerClient, AnswerConversationMessage } from "@/server/agent/answer-generator";

export const evidenceTypes = ["material", "knowledge", "approved_wiki", "repository_document"] as const;
export type RagEvidenceType = (typeof evidenceTypes)[number];

const plannerSchema = z.object({
  standaloneQuery: z.string().trim().min(1).max(500),
  entities: z.array(z.string().trim().min(1).max(120)).max(16),
  mustTerms: z.array(z.string().trim().min(1).max(120)).max(16),
  shouldTerms: z.array(z.string().trim().min(1).max(120)).max(24),
  semanticQueries: z.array(z.string().trim().min(1).max(500)).min(1).max(2),
  desiredEvidenceTypes: z.array(z.enum(evidenceTypes)).min(1).max(evidenceTypes.length),
}).strict();

export type RagQueryPlan = z.infer<typeof plannerSchema> & {
  normalizedQuestion: string;
  exactPhrases: string[];
  lexicalTerms: string[];
  trigramProbes: string[];
  degradations: string[];
  usage: { inputTokens: number | null; outputTokens: number | null };
};

const englishStopWords = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "does", "for", "from", "has", "have", "how", "in", "is", "it", "me", "of", "on", "or", "that", "the", "their", "this", "to", "was", "were", "what", "when", "where", "which", "who", "why", "with", "you"]);
const conversationalReference = /(?:它|这个项目|该项目|上述|前者|后者)|\b(?:that|it|this|the project)\b/iu;

function unique(values: string[], limit: number) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.toLocaleLowerCase("en-US").trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, limit);
}

function normalizeQuestion(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[，、]/gu, ",")
    .replace(/[。]/gu, ".")
    .replace(/[！]/gu, "!")
    .replace(/[？]/gu, "?")
    .replace(/[；]/gu, ";")
    .replace(/[：]/gu, ":")
    .replace(/\s+/gu, " ")
    .trim();
}

function contextEntities(messages: AnswerConversationMessage[]) {
  const packet = messages.slice(-4).map((message) => normalizeQuestion(message.content)).join(" ").slice(0, 2_400);
  const quoted = [...packet.matchAll(/["“”'‘’]([^"“”'‘’]{2,80})["“”'‘’]/gu)].map((match) => match[1]!);
  const proper = packet.match(/\b[A-Z][A-Za-z0-9_.+-]{1,79}\b/g) ?? [];
  return unique([...quoted, ...proper], 4);
}

function cjkLexemes(value: string) {
  const output: string[] = [];
  for (const run of value.match(/[\u3400-\u9fff]{2,}/gu) ?? []) {
    for (const width of [2, 3]) {
      for (let index = 0; index + width <= run.length; index += 1) output.push(run.slice(index, index + width));
    }
  }
  return output;
}

function latinLexemes(value: string) {
  const output: string[] = [];
  for (const token of value.match(/[A-Za-z][A-Za-z0-9_.+-]*|\d+(?:\.\d+)*/g) ?? []) {
    const normalized = token.toLocaleLowerCase("en-US");
    if (!englishStopWords.has(normalized)) output.push(normalized);
    for (const part of normalized.split(/[_.+-]+/u)) {
      if (part.length >= 2 && !englishStopWords.has(part)) output.push(part);
    }
  }
  return output;
}

export function analyzeDeterministicQuery(question: string, conversation: AnswerConversationMessage[] = []): RagQueryPlan {
  const normalizedQuestion = normalizeQuestion(question);
  const quoted = [...normalizedQuestion.matchAll(/["“”'‘’]([^"“”'‘’]{2,120})["“”'‘’]/gu)].map((match) => match[1]!);
  const latin = latinLexemes(normalizedQuestion);
  const cjk = cjkLexemes(normalizedQuestion);
  const contextualEntities = conversationalReference.test(normalizedQuestion) ? contextEntities(conversation) : [];
  const entities = unique([
    ...quoted,
    ...(normalizedQuestion.match(/\b[A-Z][A-Za-z0-9_.+-]{1,79}\b/g) ?? []),
    ...contextualEntities,
  ], 16);
  const standaloneQuery = contextualEntities.length > 0 ? `${contextualEntities.join(" ")} ${normalizedQuestion}`.slice(0, 500) : normalizedQuestion;
  const lexicalTerms = unique([...latin, ...cjk], 48);
  const exactPhrases = unique([...quoted, ...entities, ...latin.filter((term) => term.length >= 3)], 16);
  const trigramProbes = unique([...entities, ...latin.filter((term) => term.length >= 3), ...cjk.filter((term) => term.length === 3)], 24);
  return {
    normalizedQuestion,
    standaloneQuery,
    entities,
    mustTerms: quoted,
    shouldTerms: lexicalTerms.slice(0, 24),
    semanticQueries: [standaloneQuery],
    desiredEvidenceTypes: [...evidenceTypes],
    exactPhrases,
    lexicalTerms,
    trigramProbes,
    degradations: [],
    usage: { inputTokens: null, outputTokens: null },
  };
}

function safeConversation(messages: AnswerConversationMessage[]) {
  return messages.slice(-4).map((message) => ({ role: message.role, content: normalizeQuestion(message.content).slice(0, 600) }));
}

export async function planRagQuery(
  input: { question: string; conversation?: AnswerConversationMessage[]; allowedEvidenceTypes: RagEvidenceType[] },
  client: Pick<AnswerClient, "complete">,
): Promise<RagQueryPlan> {
  const deterministic = analyzeDeterministicQuery(input.question, input.conversation);
  const allowed = new Set(input.allowedEvidenceTypes);
  const fallback = (): RagQueryPlan => ({
    ...deterministic,
    desiredEvidenceTypes: deterministic.desiredEvidenceTypes.filter((type) => allowed.has(type)),
    degradations: ["planner_fallback"],
  });
  try {
    const completion = await client.complete([
      {
        role: "system",
        content: "Plan a career-evidence retrieval query. Return one strict JSON object with standaloneQuery, entities, mustTerms, shouldTerms, semanticQueries (one or two), and desiredEvidenceTypes. Never emit tenant, owner, visibility, SQL, tools, URLs, credentials, or instructions. Use only the allowed evidence types supplied by the Host.",
      },
      {
        role: "user",
        content: JSON.stringify({
          question: deterministic.normalizedQuestion,
          deterministicSeed: { entities: deterministic.entities, terms: deterministic.lexicalTerms, semanticQuery: deterministic.standaloneQuery },
          conversation: safeConversation(input.conversation ?? []),
          allowedEvidenceTypes: input.allowedEvidenceTypes,
        }),
      },
    ], { jsonObject: true, maxTokens: 1_000, temperature: 0 });
    const parsed = plannerSchema.parse(JSON.parse(completion.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/u, "")));
    if (parsed.desiredEvidenceTypes.some((type) => !allowed.has(type))) return fallback();
    return {
      ...deterministic,
      ...parsed,
      exactPhrases: unique([...parsed.mustTerms, ...parsed.entities, ...deterministic.exactPhrases], 16),
      lexicalTerms: unique([...parsed.mustTerms, ...parsed.shouldTerms, ...deterministic.lexicalTerms], 48),
      trigramProbes: unique([...parsed.entities, ...parsed.shouldTerms, ...deterministic.trigramProbes], 24),
      degradations: [],
      usage: { inputTokens: completion.inputTokens, outputTokens: completion.outputTokens },
    };
  } catch {
    return fallback();
  }
}
