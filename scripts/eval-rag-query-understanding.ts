import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { OpenAiChatClient } from "../src/server/ai/openai-compatible";
import { getRuntimeConfig } from "../src/server/config";
import {
  detectAuthorizedEntityMentions,
  normalizeEntityAlias,
  type AuthorizedEntityCatalog,
  type CatalogEntity,
} from "../src/server/rag/entity-catalog";
import {
  planRagQuery,
  ragKnowledgeScopes,
  ragQueryModes,
  ragQuerySubjects,
  ragRequestedFields,
} from "../src/server/rag/query-planner";

const mentionSchema = z.object({
  text: z.string().min(1),
  type: z.enum(["person", "organization", "project", "product", "repository", "technology", "other"]),
  source: z.enum(["explicit", "contextual"]),
  role: z.enum(["required", "context"]),
}).strict();
const caseSchema = z.object({
  id: z.string(),
  question: z.string().min(1),
  conversation: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }).strict()).optional(),
  trustedContext: z.array(mentionSchema).optional(),
  expected: z.object({
    queryMode: z.enum(ragQueryModes),
    subject: z.enum(ragQuerySubjects).optional(),
    knowledgeScope: z.enum(ragKnowledgeScopes).optional(),
    required: z.array(z.string()),
    context: z.array(z.string()).optional(),
    requestedFields: z.array(z.enum(ragRequestedFields)),
    timeRange: z.object({ start: z.string(), end: z.string() }).strict().optional(),
  }).strict(),
}).strict();

function entity(key: string, type: CatalogEntity["type"], canonicalName: string, aliases: string[] = []): CatalogEntity {
  return { key, type, canonicalName, aliases, materialIds: [`material:${key}`], repositoryIds: type === "repository" ? [`repository:${key}`] : [] };
}

function catalog(): AuthorizedEntityCatalog {
  const entities = [
    entity("project:askme", "project", "Askme"),
    entity("project:onecat", "project", "OneCat", ["one-cat"]),
    entity("organization:futu", "organization", "富途控股", ["富途"]),
    entity("repository:copybook", "repository", "copybook", ["monshunter/copybook"]),
    entity("technology:rag", "technology", "RAG"),
    entity("technology:kubernetes", "technology", "Kubernetes", ["K8s"]),
  ];
  const aliases = new Map<string, string[]>();
  for (const item of entities) {
    for (const alias of [item.canonicalName, ...item.aliases]) {
      const key = normalizeEntityAlias(alias);
      aliases.set(key, [...new Set([...(aliases.get(key) ?? []), item.key])]);
    }
  }
  return { entities, aliases };
}

function normalized(values: string[]) {
  return [...new Set(values.map(normalizeEntityAlias))].sort();
}

async function main() {
  const allCases = (await readFile(path.resolve(process.cwd(), "scripts/fixtures/rag-v4/query-semantics-cases.jsonl"), "utf8"))
    .split("\n").filter(Boolean).map((line) => caseSchema.parse(JSON.parse(line)));
  if (allCases.length < 18) throw new Error(`QUERY_SEMANTICS_CASE_COUNT:${allCases.length}`);
  const selectedId = process.env.ASKME_RAG_QUERY_CASE?.trim();
  const cases = selectedId ? allCases.filter((item) => item.id === selectedId) : allCases;
  if (cases.length === 0) throw new Error(`QUERY_SEMANTICS_CASE_NOT_FOUND:${selectedId}`);
  const config = getRuntimeConfig();
  const client = new OpenAiChatClient({ apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl, profile: config.ai.profiles.planner });
  const authorizedCatalog = catalog();
  const failures: Array<{ id: string; reasons: string[] }> = [];
  let requiredRoleFalsePositive = 0;
  let requiredEntityMiss = 0;
  let discoveryFalseNone = 0;
  let entitySubstitution = 0;
  for (const item of cases) {
    const candidates = detectAuthorizedEntityMentions(item.question, authorizedCatalog, "explicit", "context");
    const plan = await planRagQuery({
      question: item.question,
      conversation: item.conversation,
      allowedEvidenceTypes: ["material", "knowledge", "approved_wiki", "repository_document"],
      catalogCandidates: candidates,
      trustedContextMentions: item.trustedContext,
    }, client);
    const reasons: string[] = [];
    const actualRequired = plan.entityMentions.filter((mention) => mention.role === "required").map((mention) => mention.text);
    const actualContext = plan.entityMentions.filter((mention) => mention.role === "context").map((mention) => mention.text);
    const unexpectedRequired = actualRequired.filter((value) => !normalized(item.expected.required).includes(normalizeEntityAlias(value)));
    const missedRequired = item.expected.required.filter((value) => !normalized(actualRequired).includes(normalizeEntityAlias(value)));
    if (unexpectedRequired.length > 0) { requiredRoleFalsePositive += 1; reasons.push(`required_false_positive:${unexpectedRequired.join(",")}`); }
    if (missedRequired.length > 0) { requiredEntityMiss += 1; reasons.push(`required_miss:${missedRequired.join(",")}`); }
    if (item.expected.required.length > 0 && actualRequired.some((value) => !normalizeEntityAlias(item.question).includes(normalizeEntityAlias(value)) && !(item.trustedContext ?? []).some((mention) => normalizeEntityAlias(mention.text) === normalizeEntityAlias(value)))) {
      entitySubstitution += 1;
      reasons.push("entity_substitution");
    }
    if (item.expected.queryMode === "discovery" && plan.queryMode !== "discovery") { discoveryFalseNone += 1; reasons.push(`query_mode:${plan.queryMode}`); }
    if (item.expected.queryMode !== "discovery" && plan.queryMode !== item.expected.queryMode) reasons.push(`query_mode:${plan.queryMode}`);
    if (item.expected.subject && plan.subject !== item.expected.subject) reasons.push(`subject:${plan.subject}`);
    if (item.expected.knowledgeScope && plan.knowledgeScope !== item.expected.knowledgeScope) reasons.push(`scope:${plan.knowledgeScope}`);
    if (!item.expected.requestedFields.every((field) => plan.requestedFields.includes(field))) reasons.push(`requested_fields:${plan.requestedFields.join(",")}`);
    if (item.expected.context && !item.expected.context.every((value) => normalized(actualContext).includes(normalizeEntityAlias(value)))) reasons.push(`context:${actualContext.join(",")}`);
    if (item.expected.timeRange && JSON.stringify(plan.constraints.timeRange) !== JSON.stringify(item.expected.timeRange)) reasons.push(`time_range:${JSON.stringify(plan.constraints.timeRange)}`);
    if (plan.degradations.includes("planner_fallback")) reasons.push(`planner_fallback:${plan.degradations.filter((item) => item !== "planner_fallback").join(",")}`);
    if (reasons.length > 0) failures.push({ id: item.id, reasons });
    console.info(JSON.stringify({ event: "rag.query-understanding.progress", id: item.id, queryMode: plan.queryMode, confidence: plan.confidence, passed: reasons.length === 0 }));
  }
  const metrics = { cases: cases.length, requiredRoleFalsePositive, requiredEntityMiss, discoveryFalseNone, entitySubstitution };
  const passed = failures.length === 0 && Object.values(metrics).slice(1).every((count) => count === 0);
  console.info(JSON.stringify({ event: "rag.query-understanding.completed", policyVersion: config.rag.policyVersion, metrics, failures, passed }));
  if (!passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "rag.query-understanding.failed", errorCode: error instanceof Error ? error.message : "UNKNOWN" }));
  process.exitCode = 1;
});
