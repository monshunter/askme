import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "pg";

const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";
const repositoryName = "monshunter/copybook";
const ragQuestion = "copybook 是一个什么样的项目？";
const deepQuestion = "copybook 的 paginate 函数在分页时如何处理剩余格子？";

async function userEnvValue(key: string) {
  try {
    const source = await readFile(path.join(os.homedir(), ".env"), "utf8");
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=\\s*(.*?)\\s*$`, "m"));
    if (!match) return undefined;
    const value = match[1]!.trim();
    return value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) ? value.slice(1, -1) : value;
  } catch {
    return undefined;
  }
}

const email = process.env.ASKME_CANDIDATE_EMAIL ?? await userEnvValue("ASKME_CANDIDATE_EMAIL") ?? "candidate@askme.local";
const password = process.env.ASKME_CANDIDATE_PASSWORD ?? await userEnvValue("ASKME_CANDIDATE_PASSWORD") ?? "Candidate-local-2026!";
const postgresUser = process.env.ASKME_POSTGRES_USER ?? await userEnvValue("ASKME_POSTGRES_USER") ?? "askme";
const postgresPassword = process.env.ASKME_POSTGRES_PASSWORD ?? await userEnvValue("ASKME_POSTGRES_PASSWORD") ?? "askme-local-only";
const postgresDatabase = process.env.ASKME_POSTGRES_DB ?? await userEnvValue("ASKME_POSTGRES_DB") ?? "askme";
const postgresPort = process.env.ASKME_POSTGRES_PORT ?? await userEnvValue("ASKME_POSTGRES_PORT") ?? "55432";
const databaseUrl = process.env.DATABASE_URL ?? await userEnvValue("DATABASE_URL") ?? `postgresql://${encodeURIComponent(postgresUser)}:${encodeURIComponent(postgresPassword)}@127.0.0.1:${postgresPort}/${postgresDatabase}`;

type Citation = {
  kind?: "document" | "repository";
  materialTitle?: string;
  repositoryTitle?: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
};
type AnalysisRun = { id: string; state: "pending" | "running" | "completed" | "failed" | "cancelled"; phase: string };
type Message = {
  id: string;
  role: "user" | "assistant";
  status: "pending" | "completed" | "failed";
  content: string;
  errorCode: string | null;
  citations: Citation[];
  analysisRun: AnalysisRun | null;
};
type Thread = {
  conversation: { id: string };
  messages: Message[];
  suggestedQuestions: string[];
  analysisRun?: AnalysisRun;
};
type Envelope<T> = { data: T | null; error: { code: string; message: string } | null };

function hasChinese(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
}

function assertChineseSuggestions(suggestions: string[] | undefined, label: string) {
  if (suggestions?.length !== 4 || !suggestions.every(hasChinese)) throw new Error(`${label} suggestions are not four Chinese follow-ups: ${JSON.stringify(suggestions)}`);
}

async function request<T>(pathname: string, cookie: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { cookie, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  const payload = await response.json() as Envelope<T>;
  if (!response.ok) throw new Error(`${pathname} failed with ${response.status}:${payload.error?.code ?? "unknown"}:${payload.error?.message ?? ""}`);
  if (!payload.data) throw new Error(`${pathname} returned no data`);
  return { response, data: payload.data };
}

async function pollThread(pathname: string, cookie: string, runId: string, headers?: HeadersInit) {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const { data } = await request<Thread>(pathname, cookie, { headers });
    const message = data.messages.find((item) => item.analysisRun?.id === runId);
    if (message?.analysisRun && !["pending", "running"].includes(message.analysisRun.state)) return { thread: data, message };
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`Deep analysis ${runId} did not settle within ten minutes`);
}

const db = new Client({ connectionString: databaseUrl });
await db.connect();
try {
  const candidate = await db.query<{ id: string }>("SELECT id FROM users WHERE email=lower($1) AND role='candidate' AND status='active'", [email]);
  const ownerId = candidate.rows[0]?.id;
  if (!ownerId) throw new Error("The configured local Candidate is unavailable");
  const repository = await db.query<{ id: string }>(
    `SELECT id FROM repositories WHERE owner_id=$1 AND lower(display_name)=lower($2) AND disabled_at IS NULL
     AND active_revision_id IS NOT NULL AND active_projection_id IS NOT NULL`,
    [ownerId, repositoryName],
  );
  if (!repository.rows[0]) throw new Error(`${repositoryName} is not ready for runtime acceptance`);
  const publication = await db.query<{ slug: string }>("SELECT slug FROM publications WHERE owner_id=$1 AND status='published' ORDER BY published_at DESC LIMIT 1", [ownerId]);
  const slug = publication.rows[0]?.slug;
  if (!slug) throw new Error("The Candidate has no published Agent for public Deep acceptance");

  const quotaBefore = await db.query<{ snapshot: unknown }>(
    "SELECT coalesce(jsonb_agg(jsonb_build_object('scopeType',scope_type,'scopeKey',scope_key,'window',window_started_at,'used',used) ORDER BY scope_type,scope_key,window_started_at),'[]'::jsonb) AS snapshot FROM analysis_quota_usage",
  );
  const suggestionUsageBefore = await db.query<{ candidate: number; public: number }>(
    `SELECT count(*) FILTER (WHERE purpose='agent.suggestions')::int AS candidate,
            count(*) FILTER (WHERE purpose='public.suggestions')::int AS public
     FROM ai_usage WHERE owner_id=$1`,
    [ownerId],
  );

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const candidateCookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  if (!login.ok || !candidateCookie) throw new Error(`Candidate login failed with ${login.status}`);

  const rag = await request<Thread>("/api/agent/preview/chat", candidateCookie, {
    method: "POST",
    body: JSON.stringify({ clientMessageId: randomUUID(), question: ragQuestion }),
  });
  const ragAnswer = rag.data.messages.at(-1);
  if (rag.response.status !== 200 || ragAnswer?.role !== "assistant" || ragAnswer.status !== "completed" || ragAnswer.errorCode || !hasChinese(ragAnswer.content)) {
    throw new Error(`The real copybook RAG answer was not a completed Chinese answer: ${JSON.stringify(ragAnswer)}`);
  }
  const ragPaths = ragAnswer.citations.map((citation) => citation.path).filter((value): value is string => Boolean(value));
  const copybookPrimaryOverviewPaths = new Set(["README.md", "README.zh-CN.md", "overview.md"]);
  const copybookSupportingOverviewPaths = new Set([...copybookPrimaryOverviewPaths, "AGENTS.md", "package.json", "docs/spec/architecture-design.md"]);
  if (
    ragPaths.length < 1 || ragPaths.length > 2 ||
    !ragPaths.some((value) => copybookPrimaryOverviewPaths.has(value)) ||
    ragPaths.some((value) => !copybookSupportingOverviewPaths.has(value))
  ) {
    throw new Error(`The real copybook RAG answer selected irrelevant source paths: ${JSON.stringify(ragPaths)}`);
  }
  assertChineseSuggestions(rag.data.suggestedQuestions, "Candidate RAG");

  const candidateDeep = await request<Thread>("/api/agent/preview/chat", candidateCookie, {
    method: "POST",
    body: JSON.stringify({ clientMessageId: randomUUID(), conversationId: rag.data.conversation.id, question: deepQuestion }),
  });
  if (candidateDeep.response.status !== 202 || !candidateDeep.data.analysisRun?.id) throw new Error("Candidate Deep was not routed to an Analysis Run");
  const candidateSettled = await pollThread("/api/agent/preview", candidateCookie, candidateDeep.data.analysisRun.id);
  if (
    candidateSettled.message.analysisRun?.state !== "completed" || candidateSettled.message.status !== "completed" ||
    candidateSettled.message.errorCode || !hasChinese(candidateSettled.message.content) || candidateSettled.message.citations.length < 1
  ) {
    throw new Error(`Candidate Deep did not complete with a grounded Chinese answer: ${JSON.stringify(candidateSettled.message)}`);
  }
  if (!candidateSettled.message.citations.some((citation) => citation.path === "src/lib/pagination.ts")) {
    throw new Error(`Candidate paginate answer did not cite its implementation: ${JSON.stringify(candidateSettled.message.citations)}`);
  }
  assertChineseSuggestions(candidateSettled.thread.suggestedQuestions, "Candidate Deep");
  if (JSON.stringify(candidateSettled.thread.suggestedQuestions) === JSON.stringify(rag.data.suggestedQuestions)) {
    throw new Error("Candidate suggestions did not update after the settled Deep answer");
  }

  const visitorAddress = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
  const visitorHeaders = { "x-forwarded-for": visitorAddress, "accept-language": "zh-CN" };
  const opened = await fetch(`${baseUrl}/api/public/agents/${slug}/session`, { method: "POST", headers: visitorHeaders });
  const openedPayload = await opened.json() as Envelope<{ visitorToken: string; conversationId: string }>;
  const visitorToken = openedPayload.data?.visitorToken;
  const publicConversationId = openedPayload.data?.conversationId;
  if (!opened.ok || !visitorToken || !publicConversationId) throw new Error(`Public session failed with ${opened.status}`);
  const publicCookie = "askme_locale=zh-CN";
  const publicHeaders = { ...visitorHeaders, "x-askme-visitor-token": visitorToken };
  const publicThreadPath = `/api/public/agents/${slug}/chat?conversationId=${publicConversationId}`;
  const initialPublic = await request<Thread>(publicThreadPath, publicCookie, { headers: publicHeaders });
  assertChineseSuggestions(initialPublic.data.suggestedQuestions, "Empty public conversation");

  const publicDeep = await request<Thread>(`/api/public/agents/${slug}/chat`, publicCookie, {
    method: "POST",
    headers: publicHeaders,
    body: JSON.stringify({ clientMessageId: randomUUID(), conversationId: publicConversationId, question: deepQuestion }),
  });
  if (publicDeep.response.status !== 202 || !publicDeep.data.analysisRun?.id) throw new Error("Public Deep was not routed to an Analysis Run");
  const publicSettled = await pollThread(publicThreadPath, publicCookie, publicDeep.data.analysisRun.id, publicHeaders);
  if (
    publicSettled.message.analysisRun?.state !== "completed" || publicSettled.message.status !== "completed" ||
    publicSettled.message.errorCode || !hasChinese(publicSettled.message.content) || publicSettled.message.citations.length < 1
  ) {
    throw new Error(`Public Deep did not complete with a grounded Chinese answer: ${JSON.stringify(publicSettled.message)}`);
  }
  if (!publicSettled.message.citations.some((citation) => citation.materialTitle?.includes("src/lib/pagination.ts"))) {
    throw new Error(`Public paginate answer did not cite its implementation: ${JSON.stringify(publicSettled.message.citations)}`);
  }
  assertChineseSuggestions(publicSettled.thread.suggestedQuestions, "Public Deep");
  if (JSON.stringify(publicSettled.thread.suggestedQuestions) === JSON.stringify(initialPublic.data.suggestedQuestions)) {
    throw new Error("Public suggestions did not update after the settled Deep answer");
  }

  const quotaAfter = await db.query<{ snapshot: unknown }>(
    "SELECT coalesce(jsonb_agg(jsonb_build_object('scopeType',scope_type,'scopeKey',scope_key,'window',window_started_at,'used',used) ORDER BY scope_type,scope_key,window_started_at),'[]'::jsonb) AS snapshot FROM analysis_quota_usage",
  );
  if (JSON.stringify(quotaAfter.rows[0]?.snapshot) !== JSON.stringify(quotaBefore.rows[0]?.snapshot)) {
    throw new Error("Conversation Deep changed count-based analysis quota usage");
  }
  const suggestionUsageAfter = await db.query<{ candidate: number; public: number }>(
    `SELECT count(*) FILTER (WHERE purpose='agent.suggestions')::int AS candidate,
            count(*) FILTER (WHERE purpose='public.suggestions')::int AS public
     FROM ai_usage WHERE owner_id=$1`,
    [ownerId],
  );
  const beforeUsage = suggestionUsageBefore.rows[0] ?? { candidate: 0, public: 0 };
  const afterUsage = suggestionUsageAfter.rows[0] ?? { candidate: 0, public: 0 };
  const suggestionGeneration = {
    candidateLlmGenerated: afterUsage.candidate > beforeUsage.candidate,
    publicLlmGenerated: afterUsage.public > beforeUsage.public,
  };
  const routeAudits = await db.query<{ effectiveRoute: string; reasonCode: string }>(
    `SELECT metadata->>'effectiveRoute' AS "effectiveRoute",metadata->>'reasonCode' AS "reasonCode"
     FROM audit_events WHERE action='agent.question.route' AND target_type='conversation' AND target_id=ANY($1::text[])
     ORDER BY created_at`,
    [[rag.data.conversation.id, publicSettled.thread.conversation.id]],
  );
  if (routeAudits.rows.filter((row) => row.effectiveRoute === "deep").length < 2) {
    throw new Error(`Candidate/Public Deep routes were not auditable: ${JSON.stringify(routeAudits.rows)}`);
  }

  console.log(JSON.stringify({
    event: "smoke.agent-runtime-acceptance.completed",
    rag: { question: ragQuestion, citationPaths: ragPaths, answerLanguage: "zh-CN" },
    candidateDeep: {
      runId: candidateDeep.data.analysisRun.id,
      citationPaths: candidateSettled.message.citations.map((citation) => citation.path),
      answerLanguage: "zh-CN",
    },
    publicDeep: {
      runId: publicDeep.data.analysisRun.id,
      citationPaths: publicSettled.message.citations.map((citation) => citation.path),
      answerLanguage: "zh-CN",
    },
    suggestions: { ...suggestionGeneration, fallbackAllowed: true, sameLanguage: true },
    countQuotaUnchanged: true,
    routesAudited: true,
  }));
} finally {
  await db.end();
}
