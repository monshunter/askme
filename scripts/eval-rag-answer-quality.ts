import { randomUUID } from "node:crypto";

import { OpenAiChatClient } from "../src/server/ai/openai-compatible";
import { getRuntimeConfig } from "../src/server/config";
import type { RetrievedRagEvidence } from "../src/server/rag/hybrid-retriever";
import { generateVerifiedRagAnswer } from "../src/server/rag/rag-answer";

function evidence(content: string): RetrievedRagEvidence {
  return {
    evidenceId: randomUUID(),
    parentId: randomUUID(),
    stableKey: randomUUID().replaceAll("-", "").padEnd(64, "0"),
    sourceVersionId: randomUUID(),
    indexVersionId: randomUUID(),
    sourceKind: "material",
    sourceId: randomUUID(),
    repositoryId: null,
    sourceRevision: "synthetic-answer-quality-v1",
    evidenceFamilyId: randomUUID().replaceAll("-", "").padEnd(64, "0"),
    visibility: "citation_allowed",
    title: "Synthetic career profile",
    path: null,
    commitSha: null,
    revisionId: null,
    sourceContentHash: null,
    structurePath: "Experience",
    content,
    parentContent: content,
    tokenCount: Math.ceil(content.length / 2),
    sourceRange: { lineStart: 1, lineEnd: content.split("\n").length },
    contentChecksum: "f".repeat(64),
    score: 1,
    rrfScore: 1,
    routeRanks: { exact: 1, lexical: 1 },
  };
}

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

async function main() {
  const config = getRuntimeConfig();
  const currentDate = new Date().toISOString().slice(0, 10);
  const currentYear = Number(currentDate.slice(0, 4));
  const generatorClient = new OpenAiChatClient({ apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl, profile: config.ai.profiles.rag });
  const verifierClient = new OpenAiChatClient({ apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl, profile: config.ai.profiles.verifier });
  const settings = { answerTone: "professional" as const, privacySafeMode: true };

  const duration = await generateVerifiedRagAnswer({
    question: "工作多少年了？",
    evidence: [evidence("候选人自2017年1月起持续从事后台、平台与 AI Agent 工程工作。")],
    coverage: "full",
    unsupportedAspects: [],
    currentDate,
    settings,
    generatorClient,
    verifierClient,
  });
  assert(duration.outcome === "answered", "DURATION_NOT_ANSWERED");
  assert(!duration.answer.includes("2025"), "STALE_2025_YEAR");
  assert(
    duration.answer.includes(String(currentYear)) || duration.answer.includes(`${currentYear - 2017}年`) || duration.answer.includes("九年"),
    `CURRENT_DURATION_MISSING:${JSON.stringify(duration.answer)}`,
  );

  const history = await generateVerifiedRagAnswer({
    question: "先后在哪些公司工作？分别是什么时候？负责什么工作，取得哪些成就？",
    evidence: [evidence([
      "2014年至2017年，候选人在云帆网络担任后台工程师，负责直播后台和数据链路，交付统一接入服务。",
      "2017年至2022年，候选人在星河证券担任云原生平台工程师，负责 Kubernetes 服务治理，完成命名服务从0到1落地。",
      "2022年至今，候选人在青石科技担任 Infra 负责人，负责 DevOps、AI Infra 与内部研发平台，交付多集群 CI/CD 平台。",
    ].join("\n"))],
    coverage: "full",
    unsupportedAspects: [],
    currentDate,
    settings,
    generatorClient,
    verifierClient,
  });
  assert(history.outcome === "answered", "HISTORY_NOT_ANSWERED");
  for (const heading of ["先后在哪些公司工作", "分别是什么时候", "负责什么工作", "取得哪些成就"]) {
    assert(history.answer.includes(`### ${heading}`), `ANSWER_ASPECT_MISSING:${heading}`);
  }
  for (const company of ["云帆网络", "星河证券", "青石科技"]) assert(history.answer.includes(company), `COMPANY_MISSING:${company}`);

  console.info(JSON.stringify({
    event: "rag.answer-quality-eval.completed",
    currentDate,
    cases: 2,
    passed: true,
    durationCitationCount: duration.citations.length,
    historyCitationCount: history.citations.length,
  }));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "rag.answer-quality-eval.failed", errorCode: error instanceof Error ? error.message : "UNKNOWN" }));
  process.exitCode = 1;
});
