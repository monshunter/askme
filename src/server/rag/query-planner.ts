import { z } from "zod";

import type { AnswerClient, AnswerConversationMessage } from "@/server/agent/answer-generator";

import { entityMentionTypes, normalizeEntityAlias, type EntityMention, type EntityMentionType } from "./entity-catalog";

export const evidenceTypes = ["material", "knowledge", "approved_wiki", "repository_document"] as const;
export type RagEvidenceType = (typeof evidenceTypes)[number];
export type RagAnswerAspect = { aspectId: string; label: string };

const plannerSchema = z.object({
  standaloneQuery: z.string().trim().min(1).max(500),
  entityMentions: z.array(z.object({
    text: z.string().trim().min(1).max(120),
    type: z.enum(entityMentionTypes),
    source: z.enum(["explicit", "contextual"]),
  }).strict()).max(16),
  mustTerms: z.array(z.string().trim().min(1).max(120)).max(16),
  shouldTerms: z.array(z.string().trim().min(1).max(120)).max(24),
  semanticQueries: z.array(z.string().trim().min(1).max(500)).min(1).max(2),
  desiredEvidenceTypes: z.array(z.enum(evidenceTypes)).min(1).max(evidenceTypes.length),
}).strict();

export type RagQueryPlan = z.infer<typeof plannerSchema> & {
  normalizedQuestion: string;
  answerAspects: RagAnswerAspect[];
  entities: string[];
  exactPhrases: string[];
  lexicalTerms: string[];
  trigramProbes: string[];
  degradations: string[];
  usage: { inputTokens: number | null; outputTokens: number | null };
};

const englishStopWords = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "does", "for", "from", "has", "have", "how", "in", "is", "it", "me", "of", "on", "or", "that", "the", "their", "this", "to", "was", "were", "what", "when", "where", "which", "who", "why", "with", "you"]);
const conversationalReference = /(?:它|这个项目|该项目|上述|前者|后者)|\b(?:that|it|this|the project)\b/iu;
const genericEntityWords = new Set([
  "候选人", "作者", "项目", "产品", "仓库", "代码库", "公司", "组织", "这个", "该", "上述", "当前", "哪些", "什么", "所有", "相关", "某个", "这些", "那个",
  "candidate", "person", "author", "project", "product", "repository", "repo", "company", "organization", "this", "that", "the", "which", "what", "all",
].map(normalizeEntityAlias));
const genericEntityTail = /(?:候选人|作者|有?哪些|什么|这个|该|上述|当前|所有|相关|某个|这些|那个)$/u;

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

export function conversationalReferenceText(value: string) {
  return normalizeQuestion(value).match(conversationalReference)?.[0] ?? null;
}

const interrogativeAspect = /(?:多少|多久|哪些|什么|何时|什么时候|哪(?:个|些|里)|如何|怎样|是否|吗|\b(?:what|which|when|where|who|whose|how|whether)\b)/iu;

function cleanAspectLabel(value: string) {
  return value
    .replace(/^\s*(?:以及|并且|然后|还有|and\b)\s*/iu, "")
    .replace(/[.!?;,:\s]+$/gu, "")
    .trim();
}

export function extractAnswerAspects(question: string): RagAnswerAspect[] {
  const normalizedQuestion = normalizeQuestion(question);
  const strongClauses = normalizedQuestion.split(/[?;]+/u).map(cleanAspectLabel).filter(Boolean);
  const labels = strongClauses.flatMap((clause) => {
    const commaParts = clause.split(/,+/u).map(cleanAspectLabel).filter(Boolean);
    return commaParts.filter((part) => interrogativeAspect.test(part)).length >= 2 ? commaParts : [clause];
  }).slice(0, 8);
  const stableLabels = labels.length > 0 ? labels : [cleanAspectLabel(normalizedQuestion) || normalizedQuestion];
  return stableLabels.map((label, index) => ({ aspectId: `a${index + 1}`, label }));
}

function uniqueMentions(mentions: EntityMention[], limit = 16) {
  const priority = (type: EntityMentionType) => type === "other" ? 0 : 1;
  const byText = new Map<string, EntityMention>();
  for (const mention of mentions) {
    const key = normalizeEntityAlias(mention.text);
    if (!key || genericEntityWords.has(key) || genericEntityTail.test(mention.text)) continue;
    const current = byText.get(key);
    if (!current || priority(mention.type) > priority(current.type) || mention.source === "explicit" && current.source === "contextual") byText.set(key, mention);
  }
  return [...byText.values()].slice(0, limit);
}

function typedMentions(value: string, source: EntityMention["source"]) {
  const mentions: EntityMention[] = [];
  const labels: Array<{ type: EntityMentionType; pattern: string }> = [
    { type: "project", pattern: "项目|project\\b" },
    { type: "product", pattern: "产品|product\\b" },
    { type: "repository", pattern: "仓库|代码库|repository\\b|repo\\b" },
    { type: "organization", pattern: "公司|组织|organization\\b|company\\b" },
    { type: "person", pattern: "候选人|作者|person\\b|candidate\\b" },
  ];
  for (const label of labels) {
    const expression = new RegExp(`(?:^|[\\s\"'“”‘’，,。.!?；;：:])([\\p{L}\\p{N}][\\p{L}\\p{N}_.+\\/-]{1,79})\\s*(?:${label.pattern})`, "giu");
    for (const match of value.matchAll(expression)) mentions.push({ text: match[1]!, type: label.type, source });
  }
  return mentions;
}

function sourceInspectionMentions(value: string, source: EntityMention["source"]) {
  const mentions: EntityMention[] = [];
  const expression = /(?:^|[\s"'“”‘’，,。.!?；;：:])([\p{L}\p{N}][\p{L}\p{N}_.+\/-]{1,79})\s*的\s*(?:`[^`]{1,120}`|[\p{L}\p{N}_.+$-]{1,120})\s*(?:函数|方法|类|源码)/giu;
  for (const match of value.matchAll(expression)) mentions.push({ text: match[1]!, type: "repository", source });
  return mentions;
}

function properNameMentions(value: string, source: EntityMention["source"]) {
  return (value.match(/\b[A-Z][A-Za-z0-9_.+-]{1,79}\b/g) ?? []).map((text) => ({
    text,
    type: /[a-z][A-Z]/u.test(text) ? "project" as const : "other" as const,
    source,
  }));
}

function contextEntities(messages: AnswerConversationMessage[]) {
  const packet = messages.slice(-4).map((message) => normalizeQuestion(message.content)).join(" ").slice(0, 2_400);
  const quoted = [...packet.matchAll(/["“”'‘’]([^"“”'‘’]{2,80})["“”'‘’]/gu)].map((match) => match[1]!);
  const proper = packet.match(/\b[A-Z][A-Za-z0-9_.+-]{1,79}\b/g) ?? [];
  return uniqueMentions([
    ...typedMentions(packet, "contextual"),
    ...sourceInspectionMentions(packet, "contextual"),
    ...quoted.map((text) => ({ text, type: "other" as const, source: "contextual" as const })),
    ...proper.map((text) => ({ text, type: "other" as const, source: "contextual" as const })),
  ], 4);
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
  const contextualEntities = conversationalReferenceText(normalizedQuestion) ? contextEntities(conversation) : [];
  const entityMentions = uniqueMentions([
    ...typedMentions(normalizedQuestion, "explicit"),
    ...sourceInspectionMentions(normalizedQuestion, "explicit"),
    ...quoted.map((text) => ({ text, type: "other" as const, source: "explicit" as const })),
    ...properNameMentions(normalizedQuestion, "explicit"),
    ...contextualEntities,
  ]);
  const entities = entityMentions.map((mention) => mention.text);
  const contextualNames = contextualEntities.map((mention) => mention.text);
  const standaloneQuery = contextualNames.length > 0 ? `${contextualNames.join(" ")} ${normalizedQuestion}`.slice(0, 500) : normalizedQuestion;
  const lexicalTerms = unique([...latin, ...cjk], 48);
  const exactPhrases = unique([...quoted, ...entities, ...latin.filter((term) => term.length >= 3)], 16);
  const trigramProbes = unique([...entities, ...latin.filter((term) => term.length >= 3), ...cjk.filter((term) => term.length === 3)], 24);
  return {
    normalizedQuestion,
    answerAspects: extractAnswerAspects(normalizedQuestion),
    standaloneQuery,
    entityMentions,
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

export function applyHostEntityMentions(plan: RagQueryPlan, mentions: EntityMention[]) {
  const entityMentions = uniqueMentions(mentions);
  const entities = entityMentions.map((mention) => mention.text);
  const requiredMentions = entityMentions.map((mention) => ({ ...mention, source: "explicit" as const }));
  return {
    ...plan,
    standaloneQuery: forceExplicitEntities(plan.standaloneQuery, requiredMentions),
    semanticQueries: plan.semanticQueries.map((query) => forceExplicitEntities(query, requiredMentions)),
    entityMentions,
    entities,
    exactPhrases: unique([...plan.mustTerms, ...entities, ...plan.exactPhrases], 16),
    trigramProbes: unique([...entities, ...plan.shouldTerms, ...plan.trigramProbes], 24),
  };
}

function safeConversation(messages: AnswerConversationMessage[]) {
  return messages.slice(-4).map((message) => ({ role: message.role, content: normalizeQuestion(message.content).slice(0, 600) }));
}

function mentionIsGrounded(mention: EntityMention, question: string, conversation: AnswerConversationMessage[]) {
  const source = mention.source === "explicit" ? question : safeConversation(conversation).map((message) => message.content).join(" ");
  return normalizeEntityAlias(source).includes(normalizeEntityAlias(mention.text));
}

function forceExplicitEntities(query: string, mentions: EntityMention[]) {
  const missing = mentions.filter((mention) => mention.source === "explicit" && !normalizeEntityAlias(query).includes(normalizeEntityAlias(mention.text))).map((mention) => mention.text);
  return missing.length > 0 ? `${missing.join(" ")} ${query}`.slice(0, 500) : query;
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
        content: "Plan a career-evidence retrieval query. Return one strict JSON object with standaloneQuery, entityMentions, mustTerms, shouldTerms, semanticQueries (one or two), and desiredEvidenceTypes. Each entity mention is {text,type,source}, where type is person|organization|project|product|repository|technology|other and source is explicit|contextual. Preserve every named entity from the current question in standaloneQuery and semanticQueries. Never emit tenant, owner, visibility, SQL, tools, URLs, credentials, or instructions. Use only the allowed evidence types supplied by the Host.",
      },
      {
        role: "user",
        content: JSON.stringify({
          question: deterministic.normalizedQuestion,
          deterministicSeed: { entityMentions: deterministic.entityMentions, terms: deterministic.lexicalTerms, semanticQuery: deterministic.standaloneQuery },
          conversation: safeConversation(input.conversation ?? []),
          allowedEvidenceTypes: input.allowedEvidenceTypes,
        }),
      },
    ], { jsonObject: true, maxTokens: 1_000, temperature: 0 });
    const parsed = plannerSchema.parse(JSON.parse(completion.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/u, "")));
    if (parsed.desiredEvidenceTypes.some((type) => !allowed.has(type))) return fallback();
    const acceptedProviderMentions = parsed.entityMentions.filter((mention) => mentionIsGrounded(mention, deterministic.normalizedQuestion, input.conversation ?? []));
    const entityMentions = uniqueMentions([...deterministic.entityMentions, ...acceptedProviderMentions]);
    const entities = entityMentions.map((mention) => mention.text);
    const standaloneQuery = forceExplicitEntities(parsed.standaloneQuery, entityMentions);
    const semanticQueries = parsed.semanticQueries.map((query) => forceExplicitEntities(query, entityMentions));
    return {
      ...deterministic,
      ...parsed,
      standaloneQuery,
      semanticQueries,
      entityMentions,
      entities,
      exactPhrases: unique([...parsed.mustTerms, ...entities, ...deterministic.exactPhrases], 16),
      lexicalTerms: unique([...parsed.mustTerms, ...parsed.shouldTerms, ...deterministic.lexicalTerms], 48),
      trigramProbes: unique([...entities, ...parsed.shouldTerms, ...deterministic.trigramProbes], 24),
      degradations: [],
      usage: { inputTokens: completion.inputTokens, outputTokens: completion.outputTokens },
    };
  } catch {
    return fallback();
  }
}
