import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { assessAgentQuestion } from "../src/server/agent/question-policy";
import { canUseVisibility } from "../src/server/privacy/visibility-policy";
import {
  detectAuthorizedEntityMentions,
  normalizeEntityAlias,
  resolveAuthorizedEntities,
  type AuthorizedEntityCatalog,
  type CatalogEntity,
  type ConversationEntityFocus,
  type EntityScope,
} from "../src/server/rag/entity-catalog";
import { buildEvidencePack } from "../src/server/rag/evidence-orchestrator";
import { fuseWeightedRrf, type RagRoute, type RagRouteHit, type RetrievedRagEvidence } from "../src/server/rag/hybrid-retriever";
import { analyzeDeterministicQuery, applyCatalogFallbackToPlan, type RagQueryPlan } from "../src/server/rag/query-planner";
import { resolveRagPlanEntities } from "../src/server/rag/rag-query-service";

const legacyEvidenceSchema = z.object({
  id: z.string(), sourceKind: z.enum(["material", "approved_wiki", "repository_markdown", "repository_pdf"]), family: z.string(),
  visibility: z.enum(["private", "agent_only", "citation_allowed", "public_preview"]), title: z.string(), content: z.string(), aliases: z.array(z.string()).min(1),
}).strict();
const legacyFixtureSchema = z.object({
  version: z.literal(1), synthetic: z.literal(true),
  candidates: z.array(z.object({ id: z.string(), displayName: z.string(), evidence: z.array(legacyEvidenceSchema).min(1) }).strict()).length(3),
}).strict();
const legacyCaseSchema = z.object({
  id: z.string(), candidateId: z.string(), category: z.string(), question: z.string(),
  context: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }).strict()),
  consumer: z.enum(["candidate_preview", "public_answer"]), expectedOutcome: z.string(), coverage: z.string(),
  requiredEvidenceIds: z.array(z.string()), acceptableCitationIds: z.array(z.string()).optional(), forbiddenEvidenceIds: z.array(z.string()), tags: z.array(z.string()),
}).strict();
const entityCaseSchema = z.object({
  id: z.string(),
  mentions: z.array(z.object({
    text: z.string(), type: z.enum(["person", "organization", "project", "product", "repository", "technology", "other"]), source: z.enum(["explicit", "contextual"]),
    role: z.enum(["required", "context"]).default("required"),
  }).strict()),
  expected: z.object({
    resolved: z.array(z.string()), missing: z.array(z.string()), ambiguous: z.array(z.string()), soft: z.array(z.string()),
    stopBeforeRetrieval: z.boolean(), coverageCap: z.enum(["full", "partial"]),
  }).strict(),
}).strict();
const entityQueryCaseSchema = z.object({
  id: z.string(), question: z.string().min(1),
  contextEntityFocus: z.array(z.object({
    canonicalName: z.string().min(1), type: z.enum(["person", "organization", "project", "product", "repository"]),
  }).strict()).optional(),
  expected: z.object({
    resolved: z.array(z.string()), missing: z.array(z.string()), ambiguous: z.array(z.string()), soft: z.array(z.string()),
    stopBeforeRetrieval: z.boolean(), coverageCap: z.enum(["full", "partial"]), gateReason: z.string(), standaloneContains: z.array(z.string()),
  }).strict(),
}).strict();
const catalogFixtureSchema = z.object({
  version: z.literal(1), synthetic: z.literal(true),
  candidates: z.array(z.object({
    id: z.string(), entities: z.array(z.object({
      key: z.string(), type: z.enum(["person", "organization", "project", "product", "repository", "technology"]),
      canonicalName: z.string(), aliases: z.array(z.string()), evidenceIds: z.array(z.string()).min(1),
    }).strict()),
  }).strict()).length(3),
}).strict();

type LegacyEvidence = z.infer<typeof legacyEvidenceSchema>;
type LegacyCandidate = z.infer<typeof legacyFixtureSchema>["candidates"][number];
type CatalogFixtureCandidate = z.infer<typeof catalogFixtureSchema>["candidates"][number];

function entity(key: string, type: CatalogEntity["type"], canonicalName: string, aliases: string[], materialIds: string[], repositoryIds: string[]): CatalogEntity {
  return { key, type, canonicalName, aliases, materialIds, repositoryIds };
}

function catalogFromEntities(entities: CatalogEntity[]): AuthorizedEntityCatalog {
  const aliases = new Map<string, string[]>();
  for (const item of entities) {
    for (const alias of [item.canonicalName, ...item.aliases]) {
      const normalized = normalizeEntityAlias(alias);
      aliases.set(normalized, [...new Set([...(aliases.get(normalized) ?? []), item.key])]);
    }
  }
  return { entities, aliases };
}

function regressionCatalog(): AuthorizedEntityCatalog {
  return catalogFromEntities([
    entity("project:askme", "project", "Askme", ["Askme", "ask-me"], ["material-askme"], []),
    entity("repository:onecat", "repository", "OneCat", ["OneCat", "one-cat", "owner/onecat"], ["material-onecat"], ["repository-onecat"]),
    entity("repository:copybook", "repository", "copybook", ["copybook", "owner/copybook"], [], ["repository-copybook"]),
    entity("repository:new-api", "repository", "new-api", ["new-api", "new api", "QuantumNous/new-api"], [], ["repository-new-api"]),
    entity("product:api", "product", "API", ["API"], ["material-api"], []),
    entity("project:common-a", "project", "Common A", ["common"], ["material-common-a"], []),
    entity("project:common-b", "project", "Common B", ["common"], ["material-common-b"], []),
  ]);
}

function syntheticCatalog(candidate: LegacyCandidate, fixture: CatalogFixtureCandidate) {
  const evidenceById = new Map(candidate.evidence.map((item) => [item.id, item]));
  const repositoryByEvidence = new Map<string, string>();
  const entities = fixture.entities.map((item) => {
    const materialIds: string[] = [];
    const repositoryIds = new Set<string>();
    for (const evidenceId of item.evidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) throw new Error(`CATALOG_EVIDENCE:${fixture.id}:${evidenceId}`);
      if (evidence.sourceKind === "material") materialIds.push(evidence.id);
      else {
        const repositoryId = `repository:${item.key}`;
        repositoryIds.add(repositoryId);
        repositoryByEvidence.set(evidence.id, repositoryId);
      }
    }
    return entity(item.key, item.type, item.canonicalName, item.aliases, materialIds, [...repositoryIds]);
  });
  return { catalog: catalogFromEntities(entities), repositoryByEvidence };
}

function equalStrings(actual: string[], expected: string[]) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function matchScore(packet: string, values: string[]) {
  const normalizedPacket = normalizeEntityAlias(packet);
  return [...new Set(values.map(normalizeEntityAlias).filter((value) => value.length >= 2))]
    .reduce((score, value) => score + (normalizedPacket.includes(value) ? Math.min(8, Math.max(1, value.length / 3)) : 0), 0);
}

function evidencePacket(item: LegacyEvidence) {
  return [item.title, item.content, ...item.aliases].join("\n");
}

function inScope(item: LegacyEvidence, scope: EntityScope | null, repositoryByEvidence: Map<string, string>) {
  if (!scope) return true;
  return item.sourceKind === "material"
    ? scope.materialIds.includes(item.id)
    : Boolean(repositoryByEvidence.get(item.id) && scope.repositoryIds.includes(repositoryByEvidence.get(item.id)!));
}

function routeHit(item: LegacyEvidence, repositoryId: string | null): RagRouteHit {
  const checksum = createHash("sha256").update(`${item.id}:${item.content}`).digest("hex");
  return {
    evidenceId: item.id,
    parentId: `parent:${item.id}`,
    stableKey: checksum,
    sourceVersionId: `source:${item.id}`,
    indexVersionId: "synthetic-index-v3",
    sourceKind: item.sourceKind,
    sourceId: item.id,
    repositoryId,
    sourceRevision: checksum,
    evidenceFamilyId: item.family,
    visibility: item.visibility,
    title: item.title,
    path: item.sourceKind === "material" ? null : `${item.id}.md`,
    commitSha: item.sourceKind === "material" ? null : "a".repeat(40),
    revisionId: null,
    sourceContentHash: checksum,
    structurePath: item.title,
    content: item.content,
    parentContent: item.content,
    tokenCount: Math.max(1, Math.ceil(item.content.length / 3)),
    sourceRange: { lineStart: 1, lineEnd: 1 },
    contentChecksum: checksum,
  };
}

function syntheticRoutes(candidate: LegacyCandidate, plan: RagQueryPlan, scope: EntityScope | null, repositoryByEvidence: Map<string, string>, consumer: "candidate_preview" | "public_answer") {
  const allowed = candidate.evidence.filter((item) => canUseVisibility(consumer, item.visibility) && inScope(item, scope, repositoryByEvidence));
  const signals: Record<RagRoute, string[]> = {
    exact: [...plan.exactPhrases, ...plan.entities, ...plan.mustTerms],
    lexical: [...plan.lexicalTerms, ...plan.trigramProbes],
    vector: [...plan.entities, ...plan.mustTerms, ...plan.shouldTerms, ...plan.lexicalTerms],
    structured: [...plan.entities, ...plan.mustTerms, ...plan.shouldTerms],
  };
  return Object.fromEntries((Object.keys(signals) as RagRoute[]).map((route) => [route, allowed
    .map((item) => ({ item, score: matchScore(evidencePacket(item), signals[route]) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id))
    .slice(0, route === "exact" || route === "structured" ? 20 : 30)
    .map((entry) => routeHit(entry.item, repositoryByEvidence.get(entry.item.id) ?? null))])) as Record<RagRoute, RagRouteHit[]>;
}

function syntheticRerank(candidates: RetrievedRagEvidence[], plan: RagQueryPlan, evidenceById: Map<string, LegacyEvidence>) {
  const signals = [...plan.entities, ...plan.mustTerms, ...plan.shouldTerms, ...plan.lexicalTerms];
  return candidates.map((candidate) => {
    const item = evidenceById.get(candidate.evidenceId)!;
    const semanticScore = matchScore(evidencePacket(item), signals);
    return { ...candidate, rerankScore: Math.min(1, 0.45 + semanticScore / 40), score: semanticScore + candidate.rrfScore };
  }).sort((left, right) => right.score - left.score || left.evidenceId.localeCompare(right.evidenceId)).slice(0, 8);
}

function contextFocus(context: Array<{ role: "user" | "assistant"; content: string }>, catalog: AuthorizedEntityCatalog): ConversationEntityFocus[] {
  if (context.length === 0) return [];
  const mentions = detectAuthorizedEntityMentions(context.map((message) => message.content).join("\n"), catalog, "contextual", "required");
  const resolution = resolveAuthorizedEntities(mentions, catalog);
  const focus = new Map<string, ConversationEntityFocus>();
  for (const item of resolution.resolved) {
    if (item.entity.type === "technology") continue;
    focus.set(item.entity.key, { canonicalName: item.entity.canonicalName, type: item.entity.type });
  }
  return [...focus.values()];
}

async function main() {
  const legacyRoot = path.resolve(process.cwd(), "scripts/fixtures/rag-v2");
  const fixture = legacyFixtureSchema.parse(JSON.parse(await readFile(path.join(legacyRoot, "golden-candidates.json"), "utf8")));
  const catalogFixture = catalogFixtureSchema.parse(JSON.parse(await readFile(path.resolve(process.cwd(), "scripts/fixtures/rag-v3/golden-entity-catalog.json"), "utf8")));
  const cases = (await readFile(path.join(legacyRoot, "golden-cases.jsonl"), "utf8")).split("\n").filter(Boolean).map((line) => legacyCaseSchema.parse(JSON.parse(line)));
  if (cases.length !== 120) throw new Error(`GOLDEN_CASE_COUNT:${cases.length}`);
  const candidates = new Map(fixture.candidates.map((candidate) => [candidate.id, candidate]));
  const catalogCandidates = new Map(catalogFixture.candidates.map((candidate) => [candidate.id, candidate]));
  let analyzedQuestions = 0;
  let requiredEvidence = 0;
  let initialFound = 0;
  let rerankedFound = 0;
  let unauthorizedVisibilityLeaks = 0;
  let forbiddenSelectionLeaks = 0;
  let permissionRefusals = 0;
  let permissionCases = 0;
  const permissionRefusalFailures: string[] = [];
  let provisionalCoverageMatches = 0;
  const retrievalFailures: string[] = [];
  for (const item of cases) {
    const candidate = candidates.get(item.candidateId);
    const candidateCatalogFixture = catalogCandidates.get(item.candidateId);
    if (!candidate || !candidateCatalogFixture) throw new Error(`GOLDEN_CANDIDATE:${item.id}`);
    const knownIds = new Set(candidate.evidence.map((evidence) => evidence.id));
    if ([...item.requiredEvidenceIds, ...(item.acceptableCitationIds ?? []), ...item.forbiddenEvidenceIds].some((id) => !knownIds.has(id))) throw new Error(`GOLDEN_REFERENCE:${item.id}`);
    const { catalog, repositoryByEvidence } = syntheticCatalog(candidate, candidateCatalogFixture);
    const deterministic = analyzeDeterministicQuery(item.question, item.context);
    const focus = contextFocus(item.context, catalog);
    const resolved = resolveRagPlanEntities({
      plan: deterministic,
      question: item.question,
      catalog,
      contextEntityFocus: focus,
      contextFocusControlled: item.context.length > 0,
    });
    if (!resolved.plan.standaloneQuery || resolved.plan.answerAspects.length === 0) throw new Error(`QUERY_ANALYSIS:${item.id}`);
    analyzedQuestions += 1;
    const assessment = assessAgentQuestion(item.question);
    if (item.category === "permission") {
      permissionCases += 1;
      if (!assessment.allowed) permissionRefusals += 1;
      else permissionRefusalFailures.push(item.id);
    }
    if (!assessment.allowed || resolved.entityResolution.stopBeforeRetrieval) continue;
    const routes = syntheticRoutes(candidate, resolved.plan, resolved.entityResolution.scope, repositoryByEvidence, item.consumer);
    const fused = fuseWeightedRrf(routes, { exact: 1.5, lexical: 1, vector: 1, structured: 1.2, rrfK: 60, maxChildrenPerParent: 3 });
    const evidenceById = new Map(candidate.evidence.map((evidence) => [evidence.id, evidence]));
    const reranked = syntheticRerank(fused, resolved.plan, evidenceById);
    const pack = buildEvidencePack(reranked, resolved.plan, { maxTokens: 200_000, outputReserveTokens: 8_000, safetyMarginTokens: 4_000 }, 262_144, false);
    requiredEvidence += item.requiredEvidenceIds.length;
    initialFound += item.requiredEvidenceIds.filter((id) => fused.slice(0, 30).some((candidateEvidence) => candidateEvidence.evidenceId === id)).length;
    rerankedFound += item.requiredEvidenceIds.filter((id) => reranked.some((candidateEvidence) => candidateEvidence.evidenceId === id)).length;
    forbiddenSelectionLeaks += item.forbiddenEvidenceIds.filter((id) => pack.evidence.some((candidateEvidence) => candidateEvidence.evidenceId === id)).length;
    unauthorizedVisibilityLeaks += pack.evidence.filter((candidateEvidence) => !canUseVisibility(item.consumer, candidateEvidence.visibility)).length;
    if (pack.coverage === item.coverage) provisionalCoverageMatches += 1;
    if (item.requiredEvidenceIds.some((id) => !reranked.some((candidateEvidence) => candidateEvidence.evidenceId === id))) retrievalFailures.push(item.id);
  }

  const entityCases = (await readFile(path.resolve(process.cwd(), "scripts/fixtures/rag-v3/entity-grounding-cases.jsonl"), "utf8"))
    .split("\n").filter(Boolean).map((line) => entityCaseSchema.parse(JSON.parse(line)));
  if (entityCases.length < 12) throw new Error(`ENTITY_CASE_COUNT:${entityCases.length}`);
  const entityFailures: string[] = [];
  for (const item of entityCases) {
    const result = resolveAuthorizedEntities(item.mentions, regressionCatalog());
    const matches = equalStrings(result.resolved.map((entry) => entry.entity.canonicalName), item.expected.resolved)
      && equalStrings(result.missing.map((entry) => entry.text), item.expected.missing)
      && equalStrings(result.ambiguous.map((entry) => entry.mention.text), item.expected.ambiguous)
      && equalStrings(result.soft.map((entry) => entry.text), item.expected.soft)
      && result.stopBeforeRetrieval === item.expected.stopBeforeRetrieval && result.coverageCap === item.expected.coverageCap;
    if (!matches) entityFailures.push(item.id);
  }
  const entityQueryCases = (await readFile(path.resolve(process.cwd(), "scripts/fixtures/rag-v3/entity-query-cases.jsonl"), "utf8"))
    .split("\n").filter(Boolean).map((line) => entityQueryCaseSchema.parse(JSON.parse(line)));
  const entityQueryFailures: string[] = [];
  for (const item of entityQueryCases) {
    const catalog = regressionCatalog();
    const deterministic = analyzeDeterministicQuery(item.question);
    const result = resolveRagPlanEntities({
      plan: applyCatalogFallbackToPlan(deterministic, item.question, detectAuthorizedEntityMentions(item.question, catalog, "explicit", "context")), question: item.question, catalog,
      contextEntityFocus: item.contextEntityFocus,
      contextFocusControlled: item.contextEntityFocus !== undefined,
    });
    const resolution = result.entityResolution;
    const matches = equalStrings(resolution.resolved.map((entry) => entry.entity.canonicalName), item.expected.resolved)
      && equalStrings(resolution.missing.map((entry) => entry.text), item.expected.missing)
      && equalStrings(resolution.ambiguous.map((entry) => entry.mention.text), item.expected.ambiguous)
      && equalStrings(resolution.soft.map((entry) => entry.text), item.expected.soft)
      && resolution.stopBeforeRetrieval === item.expected.stopBeforeRetrieval
      && resolution.coverageCap === item.expected.coverageCap
      && resolution.gateReason === item.expected.gateReason
      && item.expected.standaloneContains.every((value) => normalizeEntityAlias(result.plan.standaloneQuery).includes(normalizeEntityAlias(value)));
    if (!matches) entityQueryFailures.push(item.id);
  }

  const initialRecallAt30 = requiredEvidence === 0 ? 1 : initialFound / requiredEvidence;
  const rerankRecallAt8 = requiredEvidence === 0 ? 1 : rerankedFound / requiredEvidence;
  const permissionRefusalRate = permissionCases === 0 ? 1 : permissionRefusals / permissionCases;
  const passed = analyzedQuestions === 120
    && initialRecallAt30 >= 0.95
    && rerankRecallAt8 >= 0.9
    && unauthorizedVisibilityLeaks === 0
    && forbiddenSelectionLeaks === 0
    && permissionRefusalRate === 1
    && entityFailures.length === 0
    && entityQueryFailures.length === 0;
  console.info(JSON.stringify({
    event: "rag.core-eval.completed",
    syntheticRetrieval: {
      cases: cases.length,
      analyzedQuestions,
      routeAdapter: "fixture-alias-deterministic-v1",
      initialRecallAt30,
      rerankRecallAt8,
      retrievalFailures,
      unauthorizedVisibilityLeaks,
      forbiddenSelectionLeaks,
      permissionRefusalRate,
      permissionRefusalFailures,
      provisionalCoverageAgreement: provisionalCoverageMatches / cases.length,
    },
    entityGrounding: { cases: entityCases.length, failures: entityFailures },
    entityQueries: { cases: entityQueryCases.length, failures: entityQueryFailures },
    limitations: ["synthetic_route_adapter_not_database_sql", "no_provider_calls", "provisional_coverage_not_final_answerability", "no_answer_outcome_or_citation_precision_claim"],
    passed,
  }));
  if (!passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "rag.core-eval.failed", errorCode: error instanceof Error ? error.message : "UNKNOWN" }));
  process.exitCode = 1;
});
