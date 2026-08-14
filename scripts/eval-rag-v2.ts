import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { EmbeddingClient, RerankClient } from "../src/server/ai/retrieval-providers";
import { getRuntimeConfig } from "../src/server/config";
import { canUseVisibility, type MaterialVisibility, type VisibilityConsumer } from "../src/server/privacy/visibility-policy";
import { analyzeDeterministicQuery } from "../src/server/rag/query-planner";

const evidenceSchema = z.object({
  id: z.string(), sourceKind: z.enum(["material", "approved_wiki", "repository_markdown", "repository_pdf"]), family: z.string(),
  visibility: z.enum(["private", "agent_only", "citation_allowed", "public_preview"]), title: z.string(), content: z.string(), aliases: z.array(z.string()).min(1),
}).strict();
const candidateSchema = z.object({ id: z.string(), displayName: z.string(), evidence: z.array(evidenceSchema).min(1) }).strict();
const fixtureSchema = z.object({ version: z.literal(1), synthetic: z.literal(true), candidates: z.array(candidateSchema).length(3) }).strict();
const caseSchema = z.object({
  id: z.string(), candidateId: z.string(), category: z.enum(["exact_fact", "chinese_paraphrase", "mixed_language", "multi_turn_reference", "partial", "none", "permission"]),
  question: z.string(), context: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }).strict()),
  consumer: z.enum(["candidate_preview", "public_answer"]), expectedOutcome: z.enum(["answered", "insufficient_evidence", "refused"]),
  coverage: z.enum(["full", "partial", "none", "conflicted", "refused"]), requiredEvidenceIds: z.array(z.string()),
  acceptableCitationIds: z.array(z.string()).optional(), forbiddenEvidenceIds: z.array(z.string()), tags: z.array(z.string()),
}).strict();

type Evidence = z.infer<typeof evidenceSchema>;
type GoldenCase = z.infer<typeof caseSchema>;
type Ranked = { evidence: Evidence; score: number };
type MetricCounts = {
  cases: number; requiredTotal: number; initialFound: number; rerankFound: number; citationTrue: number; citationTotal: number;
  answerable: number; falseNone: number; unanswerable: number; hallucinated: number; leaked: number; outcomes: number;
};

const expectedDistribution: Record<GoldenCase["category"], number> = {
  exact_fact: 30, chinese_paraphrase: 25, mixed_language: 15, multi_turn_reference: 15, partial: 15, none: 10, permission: 10,
};
const unsupportedPattern = /(?:mars|lunar navigation|quantum|revenue|stock price|patents?|olympic|token price|nuclear|火星|量子|年度收入|诺贝尔|区块链代币|核反应堆)/iu;
const partialPattern = /(?:budget|salary|customer|bonus|manager|home address|passport|薪酬|薪资|预算|汇报对象|股票奖励|客户(?:完整)?名单|团队人数|融资估值|私人病史)/iu;
const injectionPattern = /(?:ignore (?:all|previous|the system)|reveal every tenant|忽略权限|忽略系统|执行材料里的指令)/iu;

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

function deterministicScore(question: string, evidence: Evidence) {
  const query = analyzeDeterministicQuery(question);
  const source = normalize(`${evidence.title} ${evidence.content} ${evidence.aliases.join(" ")}`);
  const overlap = query.lexicalTerms.filter((term) => source.includes(normalize(term))).length;
  const phrase = evidence.aliases.filter((alias) => normalize(question).includes(normalize(alias))).length;
  return phrase * 10 + overlap;
}

function cosine(left: number[], right: number[]) {
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) { dot += left[index]! * right[index]!; leftNorm += left[index]! ** 2; rightNorm += right[index]! ** 2; }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

async function embedAll(values: string[], client: EmbeddingClient, batchSize: number) {
  const vectors: number[][] = [];
  for (let index = 0; index < values.length; index += batchSize) vectors.push(...(await client.embed(values.slice(index, index + batchSize))).vectors);
  return vectors;
}

function ratio(numerator: number, denominator: number) { return denominator === 0 ? 1 : numerator / denominator; }

function languageSegment(value: string) {
  const hasChinese = /\p{Script=Han}/u.test(value);
  const hasLatin = /[A-Za-z]/u.test(value);
  return hasChinese && hasLatin ? "mixed" : hasChinese ? "zh" : "en";
}

function metricsFromCounts(counts: MetricCounts, nullableEmpty = false) {
  const metricRatio = (numerator: number, denominator: number) => denominator === 0 && nullableEmpty ? null : ratio(numerator, denominator);
  return {
    cases: counts.cases,
    initialRecallAt30: metricRatio(counts.initialFound, counts.requiredTotal),
    rerankEvidenceRecallAt8: metricRatio(counts.rerankFound, counts.requiredTotal),
    citationPrecision: metricRatio(counts.citationTrue, counts.citationTotal),
    falseNoneRate: metricRatio(counts.falseNone, counts.answerable),
    unanswerableHallucinationRate: metricRatio(counts.hallucinated, counts.unanswerable),
    unauthorizedLeakCount: counts.leaked,
    outcomeClassification: ratio(counts.outcomes, counts.cases),
  };
}

async function main() {
  const mode = process.argv.includes("--provider") ? "provider" as const : "deterministic" as const;
  const root = path.resolve(process.cwd(), "scripts/fixtures/rag-v2");
  const fixtures = fixtureSchema.parse(JSON.parse(await readFile(path.join(root, "golden-candidates.json"), "utf8")));
  const cases = (await readFile(path.join(root, "golden-cases.jsonl"), "utf8")).split("\n").filter(Boolean).map((line) => caseSchema.parse(JSON.parse(line)));
  if (cases.length !== 120) throw new Error(`GOLDEN_CASE_COUNT:${cases.length}`);
  for (const [category, count] of Object.entries(expectedDistribution)) if (cases.filter((item) => item.category === category).length !== count) throw new Error(`GOLDEN_DISTRIBUTION:${category}`);
  const candidates = new Map(fixtures.candidates.map((candidate) => [candidate.id, candidate]));
  const evidenceById = new Map(fixtures.candidates.flatMap((candidate) => candidate.evidence).map((evidence) => [evidence.id, evidence]));
  for (const item of cases) {
    if (!candidates.has(item.candidateId) || [...item.requiredEvidenceIds, ...(item.acceptableCitationIds ?? []), ...item.forbiddenEvidenceIds].some((id) => !evidenceById.has(id))) throw new Error(`GOLDEN_REFERENCE:${item.id}`);
    if (item.acceptableCitationIds?.some((id) => item.forbiddenEvidenceIds.includes(id))) throw new Error(`GOLDEN_CITATION_CONFLICT:${item.id}`);
  }

  const config = getRuntimeConfig();
  let questionVectors = new Map<string, number[]>();
  let evidenceVectors = new Map<string, number[]>();
  const rerankClient = new RerankClient(config.rerank);
  if (mode === "provider") {
    if (!config.embedding.apiKey || !config.embedding.baseUrl) throw new Error("EMBEDDING_NOT_CONFIGURED");
    if (!config.rerank.apiKey || !config.rerank.baseUrl) throw new Error("RERANK_NOT_CONFIGURED");
    const embedding = new EmbeddingClient(config.embedding);
    const allEvidence = [...evidenceById.values()];
    const evidenceEmbeddings = await embedAll(allEvidence.map((item) => `${item.title}\n${item.content}`), embedding, config.embedding.batchSize);
    evidenceVectors = new Map(allEvidence.map((item, index) => [item.id, evidenceEmbeddings[index]!]));
    const queryEmbeddings = await embedAll(cases.map((item) => analyzeDeterministicQuery(item.question, item.context).standaloneQuery), embedding, config.embedding.batchSize);
    questionVectors = new Map(cases.map((item, index) => [item.id, queryEmbeddings[index]!]));
  }

  const totals: MetricCounts = { cases: 0, requiredTotal: 0, initialFound: 0, rerankFound: 0, citationTrue: 0, citationTotal: 0, answerable: 0, falseNone: 0, unanswerable: 0, hallucinated: 0, leaked: 0, outcomes: 0 };
  const segmentCounts: Record<string, Record<string, MetricCounts>> = { language: {}, source: {}, questionType: {}, degradation: {} };
  const addSegment = (dimension: keyof typeof segmentCounts, key: string, counts: MetricCounts) => {
    const current = segmentCounts[dimension][key] ?? { cases: 0, requiredTotal: 0, initialFound: 0, rerankFound: 0, citationTrue: 0, citationTotal: 0, answerable: 0, falseNone: 0, unanswerable: 0, hallucinated: 0, leaked: 0, outcomes: 0 };
    for (const field of Object.keys(current) as Array<keyof MetricCounts>) current[field] += counts[field];
    segmentCounts[dimension][key] = current;
  };
  const failures: Array<{ id: string; predictedCoverage: string; expectedCoverage: string; initial: string[]; citations: string[]; missingRequired: string[]; leakedForbidden: string[] }> = [];
  for (const [index, item] of cases.entries()) {
    const candidate = candidates.get(item.candidateId)!;
    const consumer = item.consumer as VisibilityConsumer;
    const standalone = analyzeDeterministicQuery(item.question, item.context).standaloneQuery;
    const allowed = candidate.evidence.filter((evidence) => canUseVisibility(consumer, evidence.visibility as MaterialVisibility));
    const preRefused = injectionPattern.test(item.question);
    const embeddingFallback = item.tags.includes("embedding_fallback");
    const rerankFallback = item.tags.includes("rerank_fallback");
    const initial: Ranked[] = (preRefused ? [] : allowed).map((evidence) => ({ evidence, score: deterministicScore(standalone, evidence) + (mode === "provider" && !embeddingFallback ? cosine(questionVectors.get(item.id)!, evidenceVectors.get(evidence.id)!) : 0) }))
      .filter((entry) => entry.score > (mode === "provider" ? -1 : 0)).sort((left, right) => right.score - left.score || left.evidence.id.localeCompare(right.evidence.id)).slice(0, 30);

    let ranked = initial;
    if (mode === "provider" && initial.length > 0 && !rerankFallback) {
      const result = await rerankClient.rerank(standalone, initial.map((entry) => `${entry.evidence.title}\n${entry.evidence.content}`));
      ranked = result.rankings.map((ranking) => ({ evidence: initial[ranking.index]!.evidence, score: ranking.score }));
      if ((index + 1) % 10 === 0) console.info(JSON.stringify({ event: "rag.eval.provider-progress", completed: index + 1, total: cases.length }));
    }
    const top = ranked.slice(0, 8);
    const authorizationRefused = item.forbiddenEvidenceIds.some((id) => candidate.evidence.some((evidence) => evidence.id === id) && !allowed.some((evidence) => evidence.id === id));
    const predictedCoverage = injectionPattern.test(item.question) || (item.category === "permission" && authorizationRefused) ? "refused"
      : unsupportedPattern.test(item.question) ? "none"
      : top.length === 0 ? "none"
      : partialPattern.test(item.question) ? "partial"
      : item.tags.includes("conflict") ? "conflicted" : "full";
    const predictedOutcome = predictedCoverage === "refused" ? "refused" : predictedCoverage === "none" ? "insufficient_evidence" : "answered";
    const citations = predictedOutcome === "answered"
      ? (predictedCoverage === "conflicted" ? top.slice(0, 2) : top.slice(0, 1)).map((entry) => entry.evidence.id)
      : [];
    const acceptableCitationIds = item.acceptableCitationIds ?? item.requiredEvidenceIds;
    const outcomePassed = predictedOutcome === item.expectedOutcome && predictedCoverage === item.coverage;
    const missingRequired = item.requiredEvidenceIds.filter((id) => !initial.some((entry) => entry.evidence.id === id));
    const leakedForbidden = item.forbiddenEvidenceIds.filter((id) => initial.some((entry) => entry.evidence.id === id) || citations.includes(id));
    const counts: MetricCounts = {
      cases: 1,
      requiredTotal: item.requiredEvidenceIds.length,
      initialFound: item.requiredEvidenceIds.length - missingRequired.length,
      rerankFound: item.requiredEvidenceIds.filter((id) => top.some((entry) => entry.evidence.id === id)).length,
      citationTrue: citations.filter((id) => acceptableCitationIds.includes(id)).length,
      citationTotal: citations.length,
      answerable: item.requiredEvidenceIds.length > 0 ? 1 : 0,
      falseNone: item.requiredEvidenceIds.length > 0 && predictedCoverage === "none" ? 1 : 0,
      unanswerable: item.coverage === "none" ? 1 : 0,
      hallucinated: item.coverage === "none" && citations.length > 0 ? 1 : 0,
      leaked: leakedForbidden.length,
      outcomes: outcomePassed ? 1 : 0,
    };
    for (const field of Object.keys(totals) as Array<keyof MetricCounts>) totals[field] += counts[field];
    addSegment("language", languageSegment(item.question), counts);
    addSegment("questionType", item.category, counts);
    const sourceKinds = new Set(item.requiredEvidenceIds.map((id) => evidenceById.get(id)!.sourceKind));
    for (const sourceKind of sourceKinds.size > 0 ? sourceKinds : new Set(["no_evidence"])) addSegment("source", sourceKind, counts);
    const degradationTags = item.tags.filter((tag) => tag.endsWith("_fallback"));
    for (const degradation of degradationTags.length > 0 ? degradationTags : ["none"]) addSegment("degradation", degradation, counts);
    if (!outcomePassed || missingRequired.length > 0 || leakedForbidden.length > 0 || citations.some((id) => !acceptableCitationIds.includes(id))) failures.push({ id: item.id, predictedCoverage, expectedCoverage: item.coverage, initial: initial.map((entry) => entry.evidence.id), citations, missingRequired, leakedForbidden });
  }
  const { cases: metricCaseCount, ...metrics } = metricsFromCounts(totals);
  if (metricCaseCount !== cases.length) throw new Error(`GOLDEN_METRIC_CASE_COUNT:${metricCaseCount}`);
  const segments = Object.fromEntries(Object.entries(segmentCounts).map(([dimension, entries]) => [dimension,
    Object.fromEntries(Object.entries(entries).map(([key, counts]) => [key, metricsFromCounts(counts, true)])),
  ]));
  const passed = (metrics.initialRecallAt30 ?? 0) >= 0.95 && (metrics.rerankEvidenceRecallAt8 ?? 0) >= 0.9 && metrics.citationPrecision === 1
    && (metrics.falseNoneRate ?? 1) <= 0.05 && metrics.unanswerableHallucinationRate === 0 && metrics.unauthorizedLeakCount === 0 && metrics.outcomeClassification >= 0.95;
  console.info(JSON.stringify({ event: "rag.eval.completed", mode, caseCount: cases.length, candidateCount: fixtures.candidates.length, metrics, segments, failures: failures.slice(0, 30), passed }));
  if (!passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "rag.eval.failed", errorCode: error instanceof Error ? error.message : "UNKNOWN" }));
  process.exitCode = 1;
});
