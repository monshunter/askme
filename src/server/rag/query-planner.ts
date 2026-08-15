import { z } from "zod";

import type { AnswerClient, AnswerConversationMessage } from "@/server/agent/answer-generator";

import { entityMentionTypes, normalizeEntityAlias, type EntityMention, type EntityMentionType } from "./entity-catalog";

export const evidenceTypes = ["material", "knowledge", "approved_wiki", "repository_document"] as const;
export type RagEvidenceType = (typeof evidenceTypes)[number];
export type RagAnswerAspect = { aspectId: string; label: string };

export const ragQueryIntents = [
  "employment_history", "project_experience", "skill_profile", "education_history",
  "repository_knowledge", "entity_detail", "career_summary", "general_career",
] as const;
export const ragQuerySubjects = ["profile_owner", "required_entity", "general"] as const;
export const ragQueryModes = ["focused", "discovery", "clarify"] as const;
export const ragKnowledgeScopes = ["employment", "project", "skill", "education", "repository", "general"] as const;
export const ragRequestedFields = [
  "company", "job_title", "employment_period", "responsibilities", "achievements",
  "project_name", "positioning", "functions", "technologies", "skills", "education", "summary",
] as const;
export type RagRequestedField = (typeof ragRequestedFields)[number];

const timeRangeSchema = z.object({
  start: z.string().regex(/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/u),
  end: z.string().regex(/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/u),
}).strict();

const entityMentionSchema = z.object({
  text: z.string().trim().min(1).max(120),
  type: z.enum(entityMentionTypes),
  source: z.enum(["explicit", "contextual"]),
  role: z.enum(["required", "context"]),
}).strict();

const plannerSchema = z.object({
  intent: z.enum(ragQueryIntents),
  subject: z.enum(ragQuerySubjects),
  queryMode: z.enum(ragQueryModes),
  knowledgeScope: z.enum(ragKnowledgeScopes),
  standaloneQuery: z.string().trim().min(1).max(500),
  entityMentions: z.array(entityMentionSchema).max(16),
  constraints: z.object({ timeRange: timeRangeSchema.nullable() }).strict(),
  requestedFields: z.array(z.enum(ragRequestedFields)).min(1).max(12),
  confidence: z.number().min(0).max(1),
  ambiguities: z.array(z.string().trim().min(1).max(200)).max(8),
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
  adjudication: { applied: boolean; reasonCode: string | null };
  usage: { inputTokens: number | null; outputTokens: number | null };
};

const englishStopWords = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "does", "for", "from", "has", "have", "how", "in", "is", "it", "me", "of", "on", "or", "that", "the", "their", "this", "to", "was", "were", "what", "when", "where", "which", "who", "why", "with", "you"]);
const conversationalReference = /(?:它|这个项目|该项目|上述|前者|后者)|\b(?:that|it|this|the project)\b/iu;
const genericEntityWords = new Set([
  "候选人", "作者", "项目", "产品", "仓库", "代码库", "公司", "组织", "这个", "该", "上述", "当前", "哪些", "什么", "所有", "相关", "某个", "这些", "那个",
  "candidate", "person", "author", "project", "product", "repository", "repo", "company", "organization", "this", "that", "the", "which", "what", "all",
].map(normalizeEntityAlias));
const genericEntityTail = /(?:候选人|作者|有?哪些|什么|这个|该|上述|当前|所有|相关|某个|这些|那个)$/u;
const invalidNamedEntityText = /(?:我|你|他|她|它|本人|候选人|这个人|哪(?:家|个|些|里)?|什么|哪些|谁|如何|怎么|是否)|\b(?:where|what|which|who|how)\b/iu;

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

const requestedFieldPatterns: Array<{ field: RagRequestedField; patterns: RegExp[] }> = [
  { field: "company", patterns: [/(?:哪|哪些|什么)家?公司|在哪里(?:工作|任职)|在哪家|\bwhere\b.{0,24}\b(?:work|employed)\b/iu] },
  { field: "job_title", patterns: [/(?:什么|哪种|哪个)(?:职务|职位|岗位)|担任(?:的)?(?:职务|职位|岗位)?|\b(?:job title|role|position)\b/iu] },
  { field: "employment_period", patterns: [/(?:任职|工作)(?:时间|多久)|(?:什么|哪)(?:时候|一年)|何时|\bwhen\b/iu] },
  { field: "responsibilities", patterns: [/(?:主要)?负责(?:什么|哪些)?|工作内容|岗位职责|(?:做过|有哪些).{0,20}(?:相关)?工作|哪些.{0,20}相关工作|\bresponsibilit(?:y|ies)\b/iu] },
  { field: "achievements", patterns: [/(?:取得|获得|实现|达成)(?:什么|哪些)?(?:成果|成就)|工作成果|\bachievements?\b/iu] },
  { field: "project_name", patterns: [/(?:做过|参与|负责|还有)(?:的)?(?:哪些|什么)?项目|(?:哪些|什么)项目|\bwhich projects?\b|\bprojects?\b.{0,16}\b(?:built|worked|done)\b/iu] },
  { field: "positioning", patterns: [/定位|解决(?:了)?什么问题|\bpositioning\b|\bwhat problem\b/iu] },
  { field: "functions", patterns: [/核心功能|主要功能|有哪些功能|提供哪些能力|\b(?:core )?functions?\b|\bcapabilities\b/iu] },
  { field: "technologies", patterns: [/技术栈|使用(?:了)?哪些技术|什么技术|\btechnolog(?:y|ies)\b|\btech stack\b/iu] },
  { field: "skills", patterns: [/(?:哪些|什么)技能|擅长什么|能力画像|\bskills?\b/iu] },
  { field: "education", patterns: [/教育经历|学历|毕业(?:于)?|学校|\beducation\b|\bdegree\b/iu] },
];

const requestedFieldLabels: Record<RagRequestedField, { zh: string; en: string }> = {
  company: { zh: "任职公司", en: "employer" },
  job_title: { zh: "职务", en: "job title" },
  employment_period: { zh: "任职时间", en: "employment period" },
  responsibilities: { zh: "工作内容", en: "responsibilities" },
  achievements: { zh: "工作成果", en: "achievements" },
  project_name: { zh: "项目", en: "projects" },
  positioning: { zh: "定位", en: "positioning" },
  functions: { zh: "核心功能", en: "core functions" },
  technologies: { zh: "技术", en: "technologies" },
  skills: { zh: "技能", en: "skills" },
  education: { zh: "教育经历", en: "education" },
  summary: { zh: "概述", en: "summary" },
};

function inferRequestedFields(question: string): RagRequestedField[] {
  const normalized = normalizeQuestion(question);
  const found = requestedFieldPatterns.flatMap(({ field, patterns }, order) => {
    const indexes = patterns.map((pattern) => pattern.exec(normalized)?.index ?? Number.POSITIVE_INFINITY);
    const index = Math.min(...indexes);
    return Number.isFinite(index) ? [{ field, index, order }] : [];
  }).sort((left, right) => left.index - right.index || left.order - right.order).map((item) => item.field);
  return found.length > 0 ? unique(found, ragRequestedFields.length) as RagRequestedField[] : ["summary"];
}

function answerAspectsForFields(fields: RagRequestedField[], question: string): RagAnswerAspect[] {
  const language = /[\u3400-\u9fff]/u.test(question) ? "zh" : "en";
  return fields.slice(0, 8).map((field, index) => ({ aspectId: `a${index + 1}`, label: requestedFieldLabels[field][language] }));
}

export function extractAnswerAspects(question: string): RagAnswerAspect[] {
  return answerAspectsForFields(inferRequestedFields(question), question);
}

function formatMonth(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function inferTimeRange(question: string) {
  const normalized = normalizeQuestion(question);
  const yearRange = /((?:19|20)\d{2})\s*年?\s*(?:到|至|~|～|—|–|-)\s*((?:19|20)\d{2})\s*年?/u.exec(normalized);
  if (yearRange) {
    const startYear = Number(yearRange[1]);
    const endYear = Number(yearRange[2]);
    return startYear <= endYear ? { start: formatMonth(startYear, 1), end: formatMonth(endYear, 12) } : null;
  }
  const monthRange = /((?:19|20)\d{2})(?:[.\/-](\d{1,2})|年\s*(\d{1,2})月)\s*(?:到|至|~|～|—|–|-)\s*((?:19|20)\d{2})(?:[.\/-](\d{1,2})|年\s*(\d{1,2})月)/u.exec(normalized);
  if (monthRange) {
    const startYear = Number(monthRange[1]);
    const startMonth = Number(monthRange[2] ?? monthRange[3]);
    const endYear = Number(monthRange[4]);
    const endMonth = Number(monthRange[5] ?? monthRange[6]);
    if (startMonth >= 1 && startMonth <= 12 && endMonth >= 1 && endMonth <= 12
      && startYear * 12 + startMonth <= endYear * 12 + endMonth) {
      return { start: formatMonth(startYear, startMonth), end: formatMonth(endYear, endMonth) };
    }
  }
  const singleYear = /(?:^|[^\d])((?:19|20)\d{2})\s*年(?:[^\d]|$)/u.exec(normalized);
  return singleYear ? { start: formatMonth(Number(singleYear[1]), 1), end: formatMonth(Number(singleYear[1]), 12) } : null;
}

function uniqueMentions(mentions: EntityMention[], limit = 16) {
  const priority = (type: EntityMentionType) => type === "other" ? 0 : 1;
  const rolePriority = (role: EntityMention["role"]) => role === "required" ? 1 : 0;
  const byText = new Map<string, EntityMention>();
  for (const mention of mentions) {
    const key = normalizeEntityAlias(mention.text);
    if (!key || genericEntityWords.has(key) || genericEntityTail.test(mention.text) || invalidNamedEntityText.test(mention.text)) continue;
    const current = byText.get(key);
    if (!current) {
      byText.set(key, mention);
      continue;
    }
    byText.set(key, {
      text: priority(mention.type) > priority(current.type) ? mention.text : current.text,
      type: priority(mention.type) > priority(current.type) ? mention.type : current.type,
      source: mention.source === "explicit" || current.source === "explicit" ? "explicit" : "contextual",
      role: rolePriority(mention.role) > rolePriority(current.role) ? mention.role : current.role,
    });
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
    for (const match of value.matchAll(expression)) mentions.push({ text: match[1]!, type: label.type, source, role: "required" });
  }
  return mentions;
}

function sourceInspectionMentions(value: string, source: EntityMention["source"]) {
  const mentions: EntityMention[] = [];
  const expression = /(?:^|[\s"'“”‘’，,。.!?；;：:])([\p{L}\p{N}][\p{L}\p{N}_.+\/-]{1,79})\s*的\s*(?:`[^`]{1,120}`|[\p{L}\p{N}_.+$-]{1,120})\s*(?:函数|方法|类|源码)/giu;
  for (const match of value.matchAll(expression)) mentions.push({ text: match[1]!, type: "repository", source, role: "required" });
  return mentions;
}

function properNameMentions(value: string, source: EntityMention["source"]) {
  return (value.match(/\b[A-Z][A-Za-z0-9_.+-]{1,79}\b/g) ?? []).map((text) => {
    const directTarget = new RegExp(`${text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*(?:(?:项目|产品|仓库|公司|组织)\\s*)?(?:还|也)?\\s*(?:怎么样|是什么|做了什么|解决|定位|功能|能力|技术|职责|负责|如何|怎么|介绍|说明|包含|的)`, "iu").test(value);
    const enumeratedTarget = /(?:分别|各自).{0,24}(?:解决|定位|功能|能力|职责|负责|技术|是什么|怎么样)/u.test(value);
    const isAllUpper = /^[A-Z0-9_.+-]+$/u.test(text);
    return {
      text,
      type: /[a-z][A-Z]/u.test(text) ? "project" as const : "other" as const,
      source,
      role: (!isAllUpper && (directTarget || enumeratedTarget) ? "required" : "context") as "required" | "context",
    };
  });
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

function inferKnowledgeScope(question: string, fields: RagRequestedField[]) {
  if (fields.some((field) => ["company", "job_title", "employment_period", "responsibilities", "achievements"].includes(field))
    || /工作经历|任职|雇主|employment|career history/iu.test(question)) return "employment" as const;
  if (fields.includes("project_name") || /项目|产品|\bprojects?\b|\bproducts?\b/iu.test(question)) return "project" as const;
  if (fields.includes("skills") || /技能|擅长|\bskills?\b/iu.test(question)) return "skill" as const;
  if (fields.includes("education") || /教育|学历|学校|\beducation\b/iu.test(question)) return "education" as const;
  if (/仓库|代码库|源码|repository|repo\b/iu.test(question)) return "repository" as const;
  return "general" as const;
}

function inferIntent(scope: (typeof ragKnowledgeScopes)[number], fields: RagRequestedField[], hasRequiredEntity: boolean) {
  if (scope === "employment") return "employment_history" as const;
  if (scope === "project" && fields.includes("project_name") && !hasRequiredEntity) return "project_experience" as const;
  if (scope === "skill") return "skill_profile" as const;
  if (scope === "education") return "education_history" as const;
  if (scope === "repository") return "repository_knowledge" as const;
  if (hasRequiredEntity) return "entity_detail" as const;
  if (fields.length === 1 && fields[0] === "summary") return "career_summary" as const;
  return "general_career" as const;
}

const queryExpansionTerms: Record<(typeof ragKnowledgeScopes)[number], Partial<Record<RagRequestedField, string[]>>> = {
  employment: {
    company: ["任职公司", "雇主", "employer"],
    job_title: ["职位", "职务", "job title"],
    employment_period: ["任职时间", "employment period"],
    responsibilities: ["职责", "工作内容", "responsibilities"],
    achievements: ["成果", "成就", "achievements"],
  },
  project: { project_name: ["项目经历", "projects"], positioning: ["项目定位", "positioning"], functions: ["核心功能", "capabilities"] },
  skill: { skills: ["技能", "能力", "skills"], technologies: ["技术栈", "technologies"] },
  education: { education: ["教育经历", "学历", "education"] },
  repository: { positioning: ["仓库定位", "repository purpose"], functions: ["主要功能", "repository capabilities"] },
  general: {},
};

function semanticExpansion(scope: (typeof ragKnowledgeScopes)[number], fields: RagRequestedField[]) {
  return unique(fields.flatMap((field) => queryExpansionTerms[scope][field] ?? []), 16);
}

function reconcileQueryMode(
  requestedMode: (typeof ragQueryModes)[number],
  mentions: EntityMention[],
  hasUnresolvedReference: boolean,
) {
  if (hasUnresolvedReference && !mentions.some((mention) => mention.role === "required")) return "clarify" as const;
  if (mentions.some((mention) => mention.role === "required" && mention.type !== "technology" && mention.type !== "other")) return "focused" as const;
  return requestedMode === "clarify" ? "clarify" as const : "discovery" as const;
}

function defaultEvidenceTypes(scope: (typeof ragKnowledgeScopes)[number]): RagEvidenceType[] {
  if (scope === "employment" || scope === "skill" || scope === "education") return ["material", "knowledge"];
  if (scope === "repository") return ["approved_wiki", "repository_document"];
  return [...evidenceTypes];
}

export function analyzeDeterministicQuery(question: string, _conversation: AnswerConversationMessage[] = []): RagQueryPlan {
  void _conversation;
  const normalizedQuestion = normalizeQuestion(question);
  const quoted = [...normalizedQuestion.matchAll(/["“”'‘’]([^"“”'‘’]{2,120})["“”'‘’]/gu)].map((match) => match[1]!);
  const latin = latinLexemes(normalizedQuestion);
  const cjk = cjkLexemes(normalizedQuestion);
  const entityMentions = uniqueMentions([
    ...typedMentions(normalizedQuestion, "explicit"),
    ...sourceInspectionMentions(normalizedQuestion, "explicit"),
    ...quoted.map((text) => ({ text, type: "other" as const, source: "explicit" as const, role: "context" as const })),
    ...properNameMentions(normalizedQuestion, "explicit"),
  ]);
  const entities = entityMentions.map((mention) => mention.text);
  const standaloneQuery = normalizedQuestion;
  const requestedFields = inferRequestedFields(normalizedQuestion);
  const knowledgeScope = inferKnowledgeScope(normalizedQuestion, requestedFields);
  const expansion = semanticExpansion(knowledgeScope, requestedFields);
  const lexicalTerms = unique([...latin, ...cjk, ...expansion], 48);
  const exactPhrases = unique([...quoted, ...entities, ...latin.filter((term) => term.length >= 3)], 16);
  const trigramProbes = unique([...entities, ...latin.filter((term) => term.length >= 3), ...cjk.filter((term) => term.length === 3)], 24);
  const hasRequiredEntity = entityMentions.some((mention) => mention.role === "required" && mention.type !== "technology" && mention.type !== "other");
  const hasSelfSubject = /(?:^|[\s,.;!?，。；！？])(?:我|你|本人|候选人|这个人)(?:[\s,.;!?，。；！？]|$)|(?:我|你|本人|候选人|这个人)(?:在|有|做|的|曾|先后|使用|负责|担任|参与|擅长|目前)/u.test(normalizedQuestion);
  const queryMode = reconcileQueryMode(hasRequiredEntity ? "focused" : "discovery", entityMentions, Boolean(conversationalReferenceText(normalizedQuestion)));
  const subject = hasSelfSubject || queryMode === "discovery" && knowledgeScope !== "general"
    ? "profile_owner" as const
    : hasRequiredEntity ? "required_entity" as const : "general" as const;
  return {
    intent: inferIntent(knowledgeScope, requestedFields, hasRequiredEntity),
    subject,
    queryMode,
    knowledgeScope,
    normalizedQuestion,
    answerAspects: answerAspectsForFields(requestedFields, normalizedQuestion),
    standaloneQuery,
    entityMentions,
    entities,
    constraints: { timeRange: inferTimeRange(normalizedQuestion) },
    requestedFields,
    confidence: queryMode === "clarify" ? 0.4 : hasRequiredEntity ? 0.85 : 0.8,
    ambiguities: queryMode === "clarify" ? ["contextual_reference_requires_trusted_focus"] : [],
    mustTerms: quoted,
    shouldTerms: lexicalTerms.slice(0, 24),
    semanticQueries: [expansion.length > 0 ? `${standaloneQuery} ${expansion.join(" ")}`.slice(0, 500) : standaloneQuery],
    desiredEvidenceTypes: defaultEvidenceTypes(knowledgeScope),
    exactPhrases,
    lexicalTerms,
    trigramProbes,
    degradations: [],
    adjudication: { applied: false, reasonCode: null },
    usage: { inputTokens: null, outputTokens: null },
  };
}

export function applyHostEntityMentions(plan: RagQueryPlan, mentions: EntityMention[]) {
  const entityMentions = uniqueMentions(mentions);
  const entities = entityMentions.map((mention) => mention.text);
  const requiredMentions = entityMentions.filter((mention) => mention.role === "required");
  const queryMode = reconcileQueryMode(plan.queryMode, entityMentions, plan.queryMode === "clarify");
  return {
    ...plan,
    queryMode,
    subject: plan.subject === "profile_owner" ? "profile_owner" as const : queryMode === "focused" ? "required_entity" as const : plan.subject,
    standaloneQuery: forceRequiredEntities(plan.standaloneQuery, requiredMentions),
    semanticQueries: plan.semanticQueries.map((query) => forceRequiredEntities(query, requiredMentions)),
    entityMentions,
    entities,
    exactPhrases: unique([...plan.mustTerms, ...entities, ...plan.exactPhrases], 16),
    trigramProbes: unique([...entities, ...plan.shouldTerms, ...plan.trigramProbes], 24),
  };
}

function safeConversation(messages: AnswerConversationMessage[]) {
  const recent = messages.slice(-6);
  let remaining = 6_000;
  const bounded: Array<{ role: AnswerConversationMessage["role"]; content: string }> = [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index]!;
    const content = normalizeQuestion(message.content).slice(0, Math.min(1_200, remaining));
    remaining = Math.max(0, remaining - content.length);
    if (content.length > 0) bounded.unshift({ role: message.role, content });
  }
  return bounded;
}

function mentionIsGrounded(mention: EntityMention, question: string, trustedContextMentions: EntityMention[]) {
  if (mention.source === "explicit") return normalizeEntityAlias(question).includes(normalizeEntityAlias(mention.text));
  const normalized = normalizeEntityAlias(mention.text);
  return trustedContextMentions.some((trusted) => trusted.type === mention.type && normalizeEntityAlias(trusted.text) === normalized);
}

function forceRequiredEntities(query: string, mentions: EntityMention[]) {
  const missing = mentions.filter((mention) => mention.role === "required"
    && !normalizeEntityAlias(query).includes(normalizeEntityAlias(mention.text))).map((mention) => mention.text);
  return missing.length > 0 ? `${missing.join(" ")} ${query}`.slice(0, 500) : query;
}

function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function fallbackCatalogMentions(question: string, mentions: EntityMention[]) {
  return mentions.map((mention) => {
    const name = escapedPattern(mention.text.normalize("NFKC").trim());
    const isIncidentalDiscovery = new RegExp(`${name}.{0,8}(?:后|之外|以外).{0,24}(?:还|其他|哪些|什么)`, "iu").test(question);
    const isTarget = !isIncidentalDiscovery && (
      new RegExp(`${name}\\s*(?:(?:项目|产品|仓库|公司|组织)\\s*)?(?:还|也)?\\s*(?:怎么样|是什么|做了什么|解决|定位|功能|能力|技术|职责|负责|如何|怎么|介绍|说明|包含)`, "iu").test(question)
      || new RegExp(`${name}.{0,10}(?:期间|时期|任职时|工作时).{0,12}(?:负责|担任|使用|做了|参与|取得)`, "iu").test(question)
      || new RegExp(`${name}\\s*的`, "iu").test(question)
    );
    return { ...mention, role: isTarget ? "required" as const : "context" as const };
  });
}

export function applyCatalogFallbackToPlan(plan: RagQueryPlan, question: string, catalogCandidates: EntityMention[]) {
  return applyHostEntityMentions(plan, [
    ...plan.entityMentions,
    ...fallbackCatalogMentions(question, catalogCandidates),
  ]);
}

type ParsedPlannerPlan = z.infer<typeof plannerSchema>;

function mergePlannerPlan(input: {
  deterministic: RagQueryPlan;
  parsed: ParsedPlannerPlan;
  catalogCandidates: EntityMention[];
  trustedContextMentions: EntityMention[];
  allowedEvidenceTypes: Set<RagEvidenceType>;
}) {
  const acceptedProviderMentions = input.parsed.entityMentions.filter((mention) => mentionIsGrounded(
    mention, input.deterministic.normalizedQuestion, input.trustedContextMentions,
  ));
  const entityMentions = uniqueMentions([
    ...input.deterministic.entityMentions,
    ...input.catalogCandidates,
    ...input.trustedContextMentions,
    ...acceptedProviderMentions,
  ]);
  const entities = entityMentions.map((mention) => mention.text);
  const queryMode = reconcileQueryMode(
    input.parsed.queryMode,
    entityMentions,
    Boolean(conversationalReferenceText(input.deterministic.normalizedQuestion)),
  );
  const deterministicFields = input.deterministic.requestedFields.filter((field) => field !== "summary");
  const requestedFields = unique([...deterministicFields, ...input.parsed.requestedFields], ragRequestedFields.length) as RagRequestedField[];
  const effectiveFields = requestedFields.length > 0 ? requestedFields : ["summary" as const];
  const knowledgeScope = input.deterministic.knowledgeScope === "general" ? input.parsed.knowledgeScope : input.deterministic.knowledgeScope;
  const expansion = semanticExpansion(knowledgeScope, effectiveFields);
  const requiredMentions = entityMentions.filter((mention) => mention.role === "required");
  const standaloneQuery = forceRequiredEntities(input.parsed.standaloneQuery, requiredMentions);
  const semanticQueries = input.parsed.semanticQueries.map((query) => forceRequiredEntities(query, requiredMentions));
  return {
    ...input.deterministic,
    ...input.parsed,
    intent: inferIntent(knowledgeScope, effectiveFields, requiredMentions.some((mention) => mention.type !== "technology" && mention.type !== "other")),
    subject: input.deterministic.subject === "profile_owner" ? "profile_owner" as const : queryMode === "focused" ? "required_entity" as const : input.parsed.subject,
    queryMode,
    knowledgeScope,
    constraints: { timeRange: input.deterministic.constraints.timeRange ?? input.parsed.constraints.timeRange },
    requestedFields: effectiveFields,
    answerAspects: answerAspectsForFields(effectiveFields, input.deterministic.normalizedQuestion),
    standaloneQuery,
    semanticQueries: semanticQueries.map((query) => expansion.length > 0 ? `${query} ${expansion.join(" ")}`.slice(0, 500) : query),
    desiredEvidenceTypes: unique([
      ...input.deterministic.desiredEvidenceTypes,
      ...input.parsed.desiredEvidenceTypes,
    ], evidenceTypes.length).filter((type): type is RagEvidenceType => input.allowedEvidenceTypes.has(type as RagEvidenceType)),
    entityMentions,
    entities,
    exactPhrases: unique([...input.parsed.mustTerms, ...entities, ...input.deterministic.exactPhrases], 16),
    lexicalTerms: unique([...input.parsed.mustTerms, ...input.parsed.shouldTerms, ...expansion, ...input.deterministic.lexicalTerms], 48),
    trigramProbes: unique([...entities, ...input.parsed.shouldTerms, ...input.deterministic.trigramProbes], 24),
  } satisfies Omit<RagQueryPlan, "degradations" | "adjudication" | "usage">;
}

const requestedFieldAliases: Record<string, RagRequestedField> = {
  company_name: "company", employer: "company",
  title: "job_title", role: "job_title", position: "job_title",
  time_period: "employment_period", employment_time: "employment_period",
  responsibility: "responsibilities", work_content: "responsibilities", duties: "responsibilities",
  achievement: "achievements", results: "achievements",
  project: "project_name", projects: "project_name",
  core_functions: "functions", capabilities: "functions",
  technology: "technologies", tech_stack: "technologies",
  skill: "skills", degree: "education", overview: "summary",
};

function stringArray(value: unknown, limit: number, maxLength: number) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return unique(values.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, maxLength)), limit);
}

function normalizedTimeRange(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const normalize = (monthValue: unknown) => typeof monthValue === "string" && /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])/u.test(monthValue)
    ? monthValue.slice(0, 7) : null;
  const start = normalize(candidate.start);
  const end = normalize(candidate.end);
  return start && end && start <= end ? { start, end } : null;
}

function normalizePlannerCandidate(raw: unknown, seed: RagQueryPlan) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.standaloneQuery !== "string" || !Array.isArray(candidate.entityMentions)
    || !Array.isArray(candidate.requestedFields) || !(Array.isArray(candidate.semanticQueries) || typeof candidate.semanticQueries === "string")) return raw;
  const requestedFields = unique(candidate.requestedFields.flatMap((item) => {
    if (typeof item !== "string") return [];
    const normalized = item.trim().toLocaleLowerCase("en-US");
    return (ragRequestedFields as readonly string[]).includes(normalized) ? [normalized] : requestedFieldAliases[normalized] ? [requestedFieldAliases[normalized]!] : [];
  }), ragRequestedFields.length) as RagRequestedField[];
  const semanticQueries = stringArray(candidate.semanticQueries, 2, 500);
  const evidenceAliases: Record<string, RagEvidenceType> = { wiki: "approved_wiki", repository: "repository_document", repository_markdown: "repository_document", repository_pdf: "repository_document" };
  const desiredEvidenceTypes = unique((Array.isArray(candidate.desiredEvidenceTypes) ? candidate.desiredEvidenceTypes : []).flatMap((item) => {
    if (typeof item !== "string") return [];
    const normalized = item.trim().toLocaleLowerCase("en-US");
    return (evidenceTypes as readonly string[]).includes(normalized) ? [normalized] : evidenceAliases[normalized] ? [evidenceAliases[normalized]!] : [];
  }), evidenceTypes.length) as RagEvidenceType[];
  const enumValue = <T extends string>(value: unknown, values: readonly T[], fallback: T) => typeof value === "string" && values.includes(value as T) ? value as T : fallback;
  return {
    intent: enumValue(candidate.intent, ragQueryIntents, seed.intent),
    subject: enumValue(candidate.subject, ragQuerySubjects, seed.subject),
    queryMode: enumValue(candidate.queryMode, ragQueryModes, seed.queryMode),
    knowledgeScope: enumValue(candidate.knowledgeScope, ragKnowledgeScopes, seed.knowledgeScope),
    standaloneQuery: candidate.standaloneQuery.trim().slice(0, 500),
    entityMentions: candidate.entityMentions.slice(0, 16).map((item) => {
      if (!item || typeof item !== "object") return item;
      const mention = item as Record<string, unknown>;
      return {
        text: typeof mention.text === "string" ? mention.text.trim().slice(0, 120) : mention.text,
        type: mention.type,
        source: mention.source === "context" || mention.source === "conversation" ? "contextual" : mention.source === "question" ? "explicit" : mention.source,
        role: mention.role === "contextual" || mention.role === "incidental" ? "context" : mention.role,
      };
    }),
    constraints: { timeRange: normalizedTimeRange((candidate.constraints as Record<string, unknown> | undefined)?.timeRange) },
    requestedFields: requestedFields.length > 0 ? requestedFields : seed.requestedFields,
    confidence: typeof candidate.confidence === "number" ? candidate.confidence : seed.confidence,
    ambiguities: stringArray(candidate.ambiguities, 8, 200),
    mustTerms: stringArray(candidate.mustTerms, 16, 120),
    shouldTerms: stringArray(candidate.shouldTerms, 24, 120),
    semanticQueries: semanticQueries.length > 0 ? semanticQueries : [candidate.standaloneQuery.trim().slice(0, 500)],
    desiredEvidenceTypes: desiredEvidenceTypes.length > 0 ? desiredEvidenceTypes : seed.desiredEvidenceTypes,
  };
}

function parsePlannerContent(content: string, seed: RagQueryPlan) {
  const raw = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/u, ""));
  return plannerSchema.parse(normalizePlannerCandidate(raw, seed));
}

function addTokens(left: number | null, right: number | null) {
  return left === null && right === null ? null : (left ?? 0) + (right ?? 0);
}

function plannerFailureCode(error: unknown) {
  if (error instanceof z.ZodError) {
    const paths = unique(error.issues.map((issue) => issue.path.join(".") || "root"), 5);
    return `planner_schema:${paths.join(",")}`;
  }
  if (error instanceof SyntaxError) return "planner_json_invalid";
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && error.code.startsWith("AI_")) return `planner_provider:${error.code}`;
  return "planner_provider_failed";
}

export async function planRagQuery(
  input: {
    question: string;
    conversation?: AnswerConversationMessage[];
    allowedEvidenceTypes: RagEvidenceType[];
    catalogCandidates?: EntityMention[];
    trustedContextMentions?: EntityMention[];
  },
  client: Pick<AnswerClient, "complete">,
): Promise<RagQueryPlan> {
  const deterministic = analyzeDeterministicQuery(input.question, input.conversation);
  const allowed = new Set(input.allowedEvidenceTypes);
  const catalogCandidates = input.catalogCandidates ?? [];
  const hostCatalogCandidates = fallbackCatalogMentions(deterministic.normalizedQuestion, catalogCandidates);
  const trustedContextMentions = input.trustedContextMentions ?? [];
  const fallback = (reason?: string): RagQueryPlan => {
    const catalogFallback = applyCatalogFallbackToPlan(deterministic, deterministic.normalizedQuestion, catalogCandidates);
    const fallbackPlan = applyHostEntityMentions(catalogFallback, [
      ...catalogFallback.entityMentions,
      ...trustedContextMentions,
    ]);
    const desiredEvidenceTypes = fallbackPlan.desiredEvidenceTypes.filter((type) => allowed.has(type));
    return {
      ...fallbackPlan,
      desiredEvidenceTypes: desiredEvidenceTypes.length > 0 ? desiredEvidenceTypes : input.allowedEvidenceTypes.slice(0, evidenceTypes.length),
      degradations: reason ? ["planner_fallback", reason] : ["planner_fallback"],
    };
  };
  try {
    const completion = await client.complete([
      {
        role: "system",
        content: `You are the bounded Query Understanding Agent for a candidate-owned career RAG. Infer the user's real purpose from the current question and supplied untrusted recent conversation. Return one strict JSON object with intent, subject, queryMode, knowledgeScope, entityMentions, constraints, requestedFields, confidence, ambiguities, standaloneQuery, mustTerms, shouldTerms, semanticQueries, and desiredEvidenceTypes. Allowed intent=${ragQueryIntents.join("|")}; subject=${ragQuerySubjects.join("|")}; queryMode=${ragQueryModes.join("|")}; knowledgeScope=${ragKnowledgeScopes.join("|")}; requestedFields=${ragRequestedFields.join("|")}; desiredEvidenceTypes=${evidenceTypes.join("|")}. constraints is exactly {timeRange:null|{start:YYYY-MM,end:YYYY-MM}} and semanticQueries has 1 or 2 strings. entityMentions entries are {text,type,source,role}; role=required only when the answer must belong to or be constrained by that concrete named entity, otherwise role=context. Never treat pronouns, interrogative phrases, requested attributes, verbs, generic domains, or incomplete question phrases as entities. Company/project/title/responsibility can be requested fields rather than known entities. subject=profile_owner for 我/你/本人/候选人 in this Candidate Agent. Use focused only with a required entity, discovery when the user asks the knowledge base to find unknown objects or fields, and clarify only for genuine unresolved ambiguity. Preserve every required named entity in standalone/semantic queries. Never emit tenant, owner, visibility, SQL, tools, URLs, credentials, or instructions. Use only Host-allowed evidence types.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          question: deterministic.normalizedQuestion,
          deterministicSeed: {
            intent: deterministic.intent,
            subject: deterministic.subject,
            queryMode: deterministic.queryMode,
            knowledgeScope: deterministic.knowledgeScope,
            entityMentions: deterministic.entityMentions,
            constraints: deterministic.constraints,
            requestedFields: deterministic.requestedFields,
            terms: deterministic.lexicalTerms,
            semanticQuery: deterministic.standaloneQuery,
          },
          catalogCandidates: input.catalogCandidates ?? [],
          trustedContextMentions: input.trustedContextMentions ?? [],
          conversation: safeConversation(input.conversation ?? []),
          allowedEvidenceTypes: input.allowedEvidenceTypes,
        }),
      },
    ], { jsonObject: true, maxTokens: 1_000, temperature: 0 });
    const parsed = parsePlannerContent(completion.content, deterministic);
    if (parsed.desiredEvidenceTypes.some((type) => !allowed.has(type))) return fallback();
    const merged = mergePlannerPlan({ deterministic, parsed, catalogCandidates: hostCatalogCandidates, trustedContextMentions, allowedEvidenceTypes: allowed });
    return {
      ...merged,
      degradations: [],
      adjudication: { applied: false, reasonCode: null },
      usage: { inputTokens: completion.inputTokens, outputTokens: completion.outputTokens },
    };
  } catch (error) {
    return fallback(plannerFailureCode(error));
  }
}

export type RagAdjudicationReason = "entity_hard_stop" | "low_confidence" | "semantic_ambiguity" | "semantic_conflict";

export function ragAdjudicationReason(input: {
  plan: RagQueryPlan;
  stopBeforeRetrieval: boolean;
}) : RagAdjudicationReason | null {
  if (input.plan.adjudication.applied) return null;
  if (input.stopBeforeRetrieval) return "entity_hard_stop";
  if (input.plan.queryMode === "clarify" || input.plan.ambiguities.length > 0) return "semantic_ambiguity";
  if (input.plan.confidence < 0.75) return "low_confidence";
  const hasRequiredEntity = input.plan.entityMentions.some((mention) => mention.role === "required");
  if (input.plan.queryMode === "focused" !== hasRequiredEntity) return "semantic_conflict";
  return null;
}

export async function adjudicateRagQuery(input: {
  question: string;
  conversation?: AnswerConversationMessage[];
  initialPlan: RagQueryPlan;
  reason: RagAdjudicationReason;
  allowedEvidenceTypes: RagEvidenceType[];
  catalogCandidates?: EntityMention[];
  trustedContextMentions?: EntityMention[];
}, client: Pick<AnswerClient, "complete">): Promise<RagQueryPlan> {
  if (input.initialPlan.adjudication.applied) return input.initialPlan;
  const deterministic = analyzeDeterministicQuery(input.question);
  const allowed = new Set(input.allowedEvidenceTypes);
  try {
    const completion = await client.complete([
      {
        role: "system",
        content: `You are the bounded second-pass Query Semantic Adjudicator. Return the same strict Query Understanding JSON schema as the initial agent. Allowed intent=${ragQueryIntents.join("|")}; subject=${ragQuerySubjects.join("|")}; queryMode=${ragQueryModes.join("|")}; knowledgeScope=${ragKnowledgeScopes.join("|")}; requestedFields=${ragRequestedFields.join("|")}; desiredEvidenceTypes=${evidenceTypes.join("|")}. Correct only semantic mistakes that can cause a false hard-stop, false scope, false entity substitution, or unnecessary clarification. Distinguish facts already stated in the question from fields the user asks the Candidate Agent to discover. A name is role=required only when the requested answer must belong to that concrete entity; incidental examples and technologies are context. Pronouns may resolve only to trustedContextMentions. Do not invent entities, tenant data, evidence, permissions, or tools.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          reason: input.reason,
          question: deterministic.normalizedQuestion,
          initialSemantics: {
            intent: input.initialPlan.intent,
            subject: input.initialPlan.subject,
            queryMode: input.initialPlan.queryMode,
            knowledgeScope: input.initialPlan.knowledgeScope,
            entityMentions: input.initialPlan.entityMentions,
            constraints: input.initialPlan.constraints,
            requestedFields: input.initialPlan.requestedFields,
            confidence: input.initialPlan.confidence,
            ambiguities: input.initialPlan.ambiguities,
          },
          catalogCandidates: input.catalogCandidates ?? [],
          trustedContextMentions: input.trustedContextMentions ?? [],
          conversation: safeConversation(input.conversation ?? []),
          allowedEvidenceTypes: input.allowedEvidenceTypes,
        }),
      },
    ], { jsonObject: true, maxTokens: 1_000, temperature: 0 });
    const parsed = parsePlannerContent(completion.content, deterministic);
    if (parsed.desiredEvidenceTypes.some((type) => !allowed.has(type))) throw new Error("ADJUDICATION_EVIDENCE_TYPE");
    const merged = mergePlannerPlan({
      deterministic,
      parsed,
      catalogCandidates: fallbackCatalogMentions(deterministic.normalizedQuestion, input.catalogCandidates ?? []),
      trustedContextMentions: input.trustedContextMentions ?? [],
      allowedEvidenceTypes: allowed,
    });
    return {
      ...merged,
      degradations: input.initialPlan.degradations,
      adjudication: { applied: true, reasonCode: input.reason },
      usage: {
        inputTokens: addTokens(input.initialPlan.usage.inputTokens, completion.inputTokens),
        outputTokens: addTokens(input.initialPlan.usage.outputTokens, completion.outputTokens),
      },
    };
  } catch {
    return {
      ...input.initialPlan,
      degradations: unique([...input.initialPlan.degradations, "semantic_adjudication_fallback"], 12),
      adjudication: { applied: true, reasonCode: input.reason },
    };
  }
}
