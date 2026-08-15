import type { RerankClient } from "@/server/ai/retrieval-providers";
import type { RuntimeConfig } from "@/server/config";

import { deterministicTokenCount } from "./structure-chunker";
import type { HybridRetrievalResult, RetrievedRagEvidence } from "./hybrid-retriever";
import type { RagQueryPlan } from "./query-planner";

export type RagCoverage = "full" | "partial" | "none" | "conflicted";
type RerankProvider = Pick<RerankClient, "rerank">;

function unique(values: string[]) {
  return [...new Set(values)];
}

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

function entityCoverageSignals(plan: RagQueryPlan) {
  return unique(plan.entities.map(normalized).filter((term) => term.length >= 2)).slice(0, 8);
}

function coreCoverageSignals(plan: RagQueryPlan) {
  return unique([...plan.mustTerms, ...plan.entities].map(normalized).filter((term) => term.length >= 2)).slice(0, 8);
}

function coverageSignals(plan: RagQueryPlan) {
  const primary = coreCoverageSignals(plan);
  if (primary.length > 0) return primary.slice(0, 8);
  return unique(plan.lexicalTerms.map(normalized).filter((term) => term.length >= 2)).slice(0, 8);
}

export function judgeEvidenceCoverage(plan: RagQueryPlan, evidence: RetrievedRagEvidence[], rerankDegraded: boolean) {
  if (evidence.length === 0) return { coverage: "none" as const, unsupportedAspects: coverageSignals(plan) };
  const signals = coverageSignals(plan);
  const packet = normalized(evidence.map((item) => item.parentContent).join("\n"));
  const supported = signals.filter((signal) => packet.includes(signal));
  const routeBacked = evidence.some((item) => Object.keys(item.routeRanks).length >= 2);
  const rerankBacked = evidence.some((item) => (item.rerankScore ?? 0) >= 0.45);
  const coreSignals = coreCoverageSignals(plan);
  const entitySignals = entityCoverageSignals(plan);
  const requiredSignals = entitySignals.length > 0 ? entitySignals : coreSignals;
  const supportedRequired = requiredSignals.filter((signal) => packet.includes(signal));
  if (requiredSignals.length > 0 && supportedRequired.length === 0 && (rerankDegraded || !rerankBacked)) {
    return { coverage: "none" as const, unsupportedAspects: requiredSignals };
  }
  const enoughSignals = signals.length === 0 || supported.length >= Math.min(2, signals.length);
  const full = enoughSignals && (rerankDegraded ? routeBacked : routeBacked || rerankBacked);
  return {
    coverage: full ? "full" as const : "partial" as const,
    unsupportedAspects: signals.filter((signal) => !supported.includes(signal)),
  };
}

export async function rerankCandidates(query: string, candidates: RetrievedRagEvidence[], client: RerankProvider, topN: number) {
  if (candidates.length === 0) return { candidates, degradations: [] as string[], inputTokens: null as number | null };
  try {
    const response = await client.rerank(query, candidates.map((candidate) => `${candidate.title}\n${candidate.structurePath}\n${candidate.parentContent}`));
    const ranked = response.rankings.slice(0, Math.min(topN, candidates.length)).map((ranking) => ({
      ...candidates[ranking.index]!,
      rerankScore: ranking.score,
      score: ranking.score,
    }));
    return { candidates: ranked, degradations: [] as string[], inputTokens: response.inputTokens };
  } catch {
    return { candidates: candidates.slice(0, topN), degradations: ["rerank_fallback"], inputTokens: null as number | null };
  }
}

export function buildEvidencePack(
  candidates: RetrievedRagEvidence[],
  plan: RagQueryPlan,
  budget: RuntimeConfig["rag"]["evidence"],
  modelContextTokens: number,
  rerankDegraded: boolean,
) {
  const effectiveTokens = Math.max(0, Math.min(budget.maxTokens, modelContextTokens - budget.outputReserveTokens - budget.safetyMarginTokens));
  const selected: RetrievedRagEvidence[] = [];
  const parents = new Set<string>();
  let actualTokens = 0;
  for (const candidate of candidates) {
    if (parents.has(candidate.parentId)) continue;
    const tokens = Math.max(candidate.tokenCount, deterministicTokenCount(candidate.parentContent));
    if (actualTokens + tokens > effectiveTokens) continue;
    selected.push(candidate);
    parents.add(candidate.parentId);
    actualTokens += tokens;
  }
  const judged = judgeEvidenceCoverage(plan, selected, rerankDegraded);
  return {
    evidence: selected,
    configuredTokens: budget.maxTokens,
    effectiveTokens,
    actualTokens,
    independentFamilyCount: new Set(selected.map((item) => item.evidenceFamilyId)).size,
    ...judged,
  };
}

function mergeCandidates(current: RetrievedRagEvidence[], added: RetrievedRagEvidence[]) {
  const merged = new Map(current.map((candidate) => [candidate.evidenceId, candidate]));
  for (const candidate of added) {
    const previous = merged.get(candidate.evidenceId);
    merged.set(candidate.evidenceId, previous ? {
      ...previous,
      routeRanks: { ...previous.routeRanks, ...candidate.routeRanks },
      rrfScore: Math.max(previous.rrfScore, candidate.rrfScore),
      score: Math.max(previous.score, candidate.score),
    } : candidate);
  }
  return [...merged.values()].sort((left, right) => right.score - left.score || left.evidenceId.localeCompare(right.evidenceId));
}

function targetedRetryPlan(plan: RagQueryPlan, unsupportedAspects: string[]): RagQueryPlan {
  const targets = (unsupportedAspects.length > 0 ? unsupportedAspects : plan.shouldTerms.slice(0, 2)).slice(0, 2);
  const queries = targets.length > 0 ? targets.map((target) => `${plan.standaloneQuery} ${target}`.slice(0, 500)) : [`${plan.standaloneQuery} supporting evidence`.slice(0, 500)];
  return {
    ...plan,
    exactPhrases: unique([...targets, ...plan.exactPhrases]).slice(0, 16),
    mustTerms: unique([...targets, ...plan.mustTerms]).slice(0, 16),
    shouldTerms: unique([...targets, ...plan.shouldTerms]).slice(0, 24),
    semanticQueries: queries,
  };
}

export async function runBoundedRetrieval(input: {
  initialPlan: RagQueryPlan;
  config: RuntimeConfig;
  retrieve(plan: RagQueryPlan): Promise<HybridRetrievalResult>;
  rerankClient: RerankProvider;
}) {
  let plan = input.initialPlan;
  let candidates: RetrievedRagEvidence[] = [];
  const routeCounts: HybridRetrievalResult["routeCounts"][] = [];
  const degradations = [...plan.degradations];
  let pack = buildEvidencePack([], plan, input.config.rag.evidence, input.config.ai.profiles.rag.contextWindow, false);
  let rerankInputTokens: number | null = null;
  let roundCount = 0;
  while (roundCount < input.config.rag.retrieval.maxRounds) {
    roundCount += 1;
    const retrieved = await input.retrieve(plan);
    routeCounts.push(retrieved.routeCounts);
    degradations.push(...retrieved.degradations);
    candidates = mergeCandidates(candidates, retrieved.candidates);
    const reranked = await rerankCandidates(plan.standaloneQuery, candidates, input.rerankClient, input.config.rerank.topN);
    degradations.push(...reranked.degradations);
    rerankInputTokens = reranked.inputTokens;
    pack = buildEvidencePack(reranked.candidates, plan, input.config.rag.evidence, input.config.ai.profiles.rag.contextWindow, reranked.degradations.length > 0);
    if (pack.coverage === "full" || roundCount >= input.config.rag.retrieval.maxRounds) break;
    plan = targetedRetryPlan(plan, pack.unsupportedAspects);
  }
  return {
    ...pack,
    plan,
    candidates: pack.evidence,
    coverage: pack.coverage as RagCoverage,
    roundCount,
    routeCounts,
    degradations: unique(degradations),
    rerankInputTokens,
  };
}
