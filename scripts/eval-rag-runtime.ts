import { readFile } from "node:fs/promises";
import path from "node:path";

import { Pool } from "pg";
import { z } from "zod";

import { OpenAiChatClient } from "../src/server/ai/openai-compatible";
import { getRuntimeConfig, requireDatabaseUrl } from "../src/server/config";
import { generateVerifiedRagAnswer, validateRagEvidence } from "../src/server/rag/rag-answer";
import { normalizeEntityAlias } from "../src/server/rag/entity-catalog";
import { retrieveRagForQuestion } from "../src/server/rag/rag-query-service";

const caseSchema = z.object({
  id: z.string(), question: z.string().min(1), expectedOutcome: z.enum(["answered", "insufficient_evidence"]), expectedCanonical: z.string().nullable(),
  expectedCoverage: z.enum(["full", "partial", "none", "conflicted"]).optional(),
  expectedMissing: z.array(z.string()).optional(),
  expectedGateReason: z.string().optional(),
  contextEntityFocus: z.array(z.object({
    canonicalName: z.string().min(1), type: z.enum(["person", "organization", "project", "product", "repository"]),
  }).strict()).optional(),
}).strict();

async function main() {
  const ownerId = z.string().uuid().parse(process.env.ASKME_RAG_EVAL_OWNER_ID);
  const cases = (await readFile(path.resolve(process.cwd(), "scripts/fixtures/rag-v3/runtime-cases.jsonl"), "utf8"))
    .split("\n").filter(Boolean).map((line) => caseSchema.parse(JSON.parse(line)));
  if (cases.length < 12) throw new Error(`RUNTIME_CASE_COUNT:${cases.length}`);
  const config = getRuntimeConfig();
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 5 });
  const generatorClient = new OpenAiChatClient({ apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl, profile: config.ai.profiles.rag });
  const verifierClient = new OpenAiChatClient({ apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl, profile: config.ai.profiles.verifier });
  const failures: Array<{ id: string; reason: string }> = [];
  const degradationCases = [
    { id: "D001", degradation: "embedding_fallback", dependencies: { embeddingClient: { embed: async () => { throw new Error("eval_embedding_unavailable"); } } } },
    { id: "D002", degradation: "rerank_fallback", dependencies: { rerankClient: { rerank: async () => { throw new Error("eval_rerank_unavailable"); } } } },
  ] as const;
  const totalCases = cases.length + degradationCases.length;
  try {
    for (const [index, item] of cases.entries()) {
      try {
        const retrieval = await retrieveRagForQuestion({
          pool, config, ownerId, consumer: "candidate_preview", question: item.question,
          ...(item.contextEntityFocus ? { contextEntityFocus: item.contextEntityFocus } : {}),
        });
        const scope = retrieval.entityResolution.scope;
        if (scope && retrieval.candidates.some((evidence) => evidence.sourceKind === "material"
          ? !scope.materialIds.includes(evidence.sourceId)
          : !evidence.repositoryId || !scope.repositoryIds.includes(evidence.repositoryId))) throw new Error("ENTITY_SCOPE_LEAK");
        if (item.expectedCanonical) {
          const resolvedNames = retrieval.entityResolution.resolved.map((entry) => normalizeEntityAlias(entry.entity.canonicalName));
          if (!resolvedNames.includes(normalizeEntityAlias(item.expectedCanonical))) throw new Error("ENTITY_NOT_RESOLVED");
        }
        if (item.expectedMissing && !item.expectedMissing.every((name) => retrieval.entityResolution.missing.some((mention) => normalizeEntityAlias(mention.text) === normalizeEntityAlias(name)))) throw new Error("EXPECTED_MISSING_ENTITY_NOT_REPORTED");
        if (item.expectedGateReason && retrieval.entityResolution.gateReason !== item.expectedGateReason) throw new Error(`GATE_${retrieval.entityResolution.gateReason}`);
        const answer = await generateVerifiedRagAnswer({
          question: item.question,
          evidence: retrieval.candidates,
          coverage: retrieval.coverage,
          unsupportedAspects: retrieval.unsupportedAspects,
          missingEntities: [
            ...retrieval.entityResolution.missing.map((mention) => mention.text),
          ],
          ambiguousEntities: retrieval.entityResolution.ambiguous.map((entry) => entry.mention.text),
          entityReferenceIssue: retrieval.entityResolution.contextReference?.status,
          answerAspects: retrieval.plan.answerAspects,
          settings: { answerTone: "professional", privacySafeMode: true },
          generatorClient,
          verifierClient,
          validateEvidence: (citations) => validateRagEvidence(pool, ownerId, "candidate_preview", citations),
        });
        if (answer.outcome !== item.expectedOutcome) throw new Error(`OUTCOME_${answer.outcome}`);
        if (item.expectedCoverage && answer.coverage !== item.expectedCoverage) throw new Error(`COVERAGE_${answer.coverage}`);
        if (item.expectedOutcome === "answered" && answer.citations.length === 0) throw new Error("CITATION_MISSING");
        if (item.expectedMissing && item.expectedMissing.some((name) => !answer.answer.includes(name))) throw new Error("ANSWER_MISSING_ENTITY_GAP");
        if (item.expectedOutcome === "insufficient_evidence" && (retrieval.candidates.length > 0 || answer.citations.length > 0)) throw new Error("UNANSWERABLE_EVIDENCE_LEAK");
      } catch (error) {
        failures.push({ id: item.id, reason: error instanceof Error ? error.message : "UNKNOWN" });
      }
      console.info(JSON.stringify({ event: "rag.runtime-eval.progress", completed: index + 1, total: totalCases }));
    }
    for (const [index, item] of degradationCases.entries()) {
      try {
        const question = "Askme 项目的定位是什么？";
        const retrieval = await retrieveRagForQuestion({
          pool, config, ownerId, consumer: "candidate_preview", question,
        }, item.dependencies);
        if (!retrieval.degradations.includes(item.degradation)) throw new Error(`DEGRADATION_NOT_REPORTED:${item.degradation}`);
        if (!retrieval.entityResolution.resolved.some((entry) => entry.entity.canonicalName === "Askme")) throw new Error("ENTITY_NOT_RESOLVED");
        const answer = await generateVerifiedRagAnswer({
          question,
          evidence: retrieval.candidates,
          coverage: retrieval.coverage,
          unsupportedAspects: retrieval.unsupportedAspects,
          answerAspects: retrieval.plan.answerAspects,
          settings: { answerTone: "professional", privacySafeMode: true },
          generatorClient,
          verifierClient,
          validateEvidence: (citations) => validateRagEvidence(pool, ownerId, "candidate_preview", citations),
        });
        if (answer.outcome !== "answered" || answer.citations.length === 0) throw new Error(`DEGRADED_OUTCOME_${answer.outcome}`);
      } catch (error) {
        failures.push({ id: item.id, reason: error instanceof Error ? error.message : "UNKNOWN" });
      }
      console.info(JSON.stringify({ event: "rag.runtime-eval.progress", completed: cases.length + index + 1, total: totalCases }));
    }
    const passed = failures.length === 0;
    console.info(JSON.stringify({ event: "rag.runtime-eval.completed", cases: totalCases, entityCases: cases.length, degradationCases: degradationCases.length, failures, passed }));
    if (!passed) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "rag.runtime-eval.failed", errorCode: error instanceof Error ? error.message : "UNKNOWN" }));
  process.exitCode = 1;
});
