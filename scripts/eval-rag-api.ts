import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { z } from "zod";

const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.ASKME_CANDIDATE_EMAIL ?? "candidate@askme.local";
const password = process.env.ASKME_CANDIDATE_PASSWORD ?? "Candidate-local-2026!";
const expectedPolicyVersion = "entity-grounded-rag-v3";

const traceSchema = z.object({
  policyVersion: z.string(),
  coverage: z.enum(["full", "partial", "none", "conflicted"]),
  roundCount: z.number().int().nonnegative(),
  selectedEvidence: z.array(z.record(z.string(), z.unknown())),
  planner: z.object({
    entityResolution: z.object({
      mentions: z.array(z.object({ text: z.string(), type: z.string(), source: z.string() })),
      resolved: z.array(z.object({ text: z.string(), type: z.string(), canonicalName: z.string() })),
      missing: z.array(z.object({ text: z.string(), type: z.string() })),
      ambiguous: z.array(z.object({ text: z.string(), type: z.string(), candidateCount: z.number() })),
      gateReason: z.string(),
    }),
  }),
});

type Trace = z.infer<typeof traceSchema>;
type Citation = { kind?: string; chunkId?: string; materialTitle?: string; repositoryTitle?: string };
type Message = {
  id: string;
  role: "user" | "assistant";
  status: "pending" | "completed" | "failed";
  content: string;
  errorCode: string | null;
  citations: Citation[];
  retrievalTrace?: unknown;
  analysisRun?: { id: string } | null;
};
type Thread = { conversation: { id: string }; messages: Message[]; analysisRun?: { id: string } };
type Envelope<T> = { data: T | null; error: { code: string; message: string } | null };

function requireValue<T>(value: T | null | undefined, code: string): T {
  if (value === null || value === undefined) throw new Error(code);
  return value;
}

function assistant(thread: Thread) {
  const message = thread.messages.at(-1);
  if (message?.role !== "assistant" || message.status !== "completed") throw new Error("ASSISTANT_NOT_COMPLETED");
  return message;
}

async function request<T>(pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const payload = await response.json() as Envelope<T>;
  if (!response.ok || !payload.data) throw new Error(`${pathname}:${response.status}:${payload.error?.code ?? "NO_DATA"}`);
  return payload.data;
}

function assertResolved(trace: Trace, canonicalName: string, source?: "explicit" | "contextual") {
  if (!trace.planner.entityResolution.resolved.some((item) => item.canonicalName === canonicalName)) {
    throw new Error(`ENTITY_NOT_RESOLVED:${canonicalName}`);
  }
  if (source && !trace.planner.entityResolution.mentions.some((item) => item.text === canonicalName && item.source === source)) {
    throw new Error(`ENTITY_SOURCE_MISMATCH:${canonicalName}:${source}`);
  }
}

function assertGrounded(message: Message, trace: Trace) {
  if (message.errorCode || message.citations.length === 0 || trace.selectedEvidence.length === 0) throw new Error("GROUNDED_ANSWER_REQUIRED");
}

function assertInsufficient(message: Message, trace: Trace, gateReason: string) {
  if (message.errorCode !== "INSUFFICIENT_EVIDENCE" || message.citations.length !== 0) throw new Error(`INSUFFICIENT_ANSWER_REQUIRED:${message.errorCode}`);
  if (trace.roundCount !== 0 || trace.selectedEvidence.length !== 0 || trace.coverage !== "none") throw new Error("UNANSWERABLE_RETRIEVAL_LEAK");
  if (trace.planner.entityResolution.gateReason !== gateReason) throw new Error(`GATE_REASON:${trace.planner.entityResolution.gateReason}`);
}

async function main() {
  const pool = new Pool({ connectionString: requireValue(process.env.DATABASE_URL, "DATABASE_URL_REQUIRED"), max: 3 });
  try {
    const candidate = await pool.query<{ id: string }>("SELECT id FROM users WHERE email=lower($1) AND role='candidate' AND status='active'", [email]);
    const ownerId = requireValue(candidate.rows[0]?.id, "CANDIDATE_NOT_FOUND");
    const publication = await pool.query<{ slug: string }>("SELECT slug FROM publications WHERE owner_id=$1 AND status='published' ORDER BY published_at DESC LIMIT 1", [ownerId]);
    const slug = requireValue(publication.rows[0]?.slug, "PUBLISHED_AGENT_NOT_FOUND");

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    if (!login.ok || !cookie) throw new Error(`LOGIN_FAILED:${login.status}`);

    const inserted = await pool.query<{ id: string }>("INSERT INTO conversations(owner_id,mode) VALUES ($1,'preview') RETURNING id", [ownerId]);
    const candidateConversationId = requireValue(inserted.rows[0]?.id, "PREVIEW_CONVERSATION_CREATE_FAILED");
    const traceFromMessage = async (message: Message) => {
      if (message.retrievalTrace) return traceSchema.parse(message.retrievalTrace);
      const result = await pool.query<{ trace: unknown }>(
        `SELECT jsonb_build_object('policyVersion',policy_version,'coverage',coverage,'roundCount',round_count,
           'selectedEvidence',selected_evidence,'planner',planner) AS trace
         FROM rag_query_traces WHERE owner_id=$1 AND message_id=$2`,
        [ownerId, message.id],
      );
      return traceSchema.parse(result.rows[0]?.trace);
    };
    const candidateChat = async (question: string) => {
      const thread = await request<Thread>("/api/agent/preview/chat", {
        method: "POST", headers: { cookie, "content-type": "application/json", "accept-language": "zh-CN" },
        body: JSON.stringify({ clientMessageId: randomUUID(), conversationId: candidateConversationId, question }),
      });
      if (thread.analysisRun) throw new Error(`UNEXPECTED_DEEP_RUN:${question}`);
      const message = assistant(thread);
      return { message, trace: await traceFromMessage(message) };
    };

    const candidateKnown = await candidateChat("Askme 怎么样？");
    assertGrounded(candidateKnown.message, candidateKnown.trace);
    assertResolved(candidateKnown.trace, "Askme", "explicit");

    const candidateContext = await candidateChat("它解决了什么问题？");
    assertGrounded(candidateContext.message, candidateContext.trace);
    assertResolved(candidateContext.trace, "Askme", "contextual");

    const candidateMulti = await candidateChat("Askme 和 MoonBase 分别解决了什么问题？");
    assertGrounded(candidateMulti.message, candidateMulti.trace);
    assertResolved(candidateMulti.trace, "Askme", "explicit");
    if (candidateMulti.trace.coverage !== "partial" || !candidateMulti.trace.planner.entityResolution.missing.some((item) => item.text === "MoonBase") || !candidateMulti.message.content.includes("MoonBase")) {
      throw new Error("PARTIAL_ENTITY_GAP_NOT_EXPLICIT");
    }

    const candidateAmbiguous = await candidateChat("它解决了什么问题？");
    assertInsufficient(candidateAmbiguous.message, candidateAmbiguous.trace, "contextual_reference_ambiguous");

    const candidateUnknown = await candidateChat("MoonBase 怎么样？");
    assertInsufficient(candidateUnknown.message, candidateUnknown.trace, "strict_entity_missing");
    if (!candidateUnknown.trace.planner.entityResolution.missing.some((item) => item.text === "MoonBase")) throw new Error("UNKNOWN_ENTITY_NOT_REPORTED");

    const runsBefore = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM analysis_runs WHERE owner_id=$1", [ownerId]);
    const candidateUnknownDeep = await candidateChat("MoonBase 的 `deploy` 函数怎么实现？");
    assertInsufficient(candidateUnknownDeep.message, candidateUnknownDeep.trace, "strict_entity_missing");
    const runsAfter = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM analysis_runs WHERE owner_id=$1", [ownerId]);
    if (runsAfter.rows[0]?.count !== runsBefore.rows[0]?.count) throw new Error("UNKNOWN_ENTITY_TRIGGERED_DEEP");

    const address = `198.51.100.${Math.floor(Math.random() * 180) + 20}`;
    const session = await request<{ visitorToken: string; conversationId: string }>(`/api/public/agents/${slug}/session`, {
      method: "POST", headers: { "x-forwarded-for": address, "accept-language": "zh-CN" },
    });
    const publicHeaders = { "x-forwarded-for": address, "x-askme-visitor-token": session.visitorToken, "content-type": "application/json", "accept-language": "zh-CN" };
    const publicChat = async (question: string) => {
      const thread = await request<Thread>(`/api/public/agents/${slug}/chat`, {
        method: "POST", headers: publicHeaders,
        body: JSON.stringify({ clientMessageId: randomUUID(), conversationId: session.conversationId, question }),
      });
      if (thread.analysisRun) throw new Error(`UNEXPECTED_PUBLIC_DEEP_RUN:${question}`);
      const message = assistant(thread);
      return { message, trace: await traceFromMessage(message) };
    };

    const publicKnown = await publicChat("Askme 怎么样？");
    assertGrounded(publicKnown.message, publicKnown.trace);
    assertResolved(publicKnown.trace, "Askme", "explicit");
    if (publicKnown.message.citations.some((citation) => "chunkId" in citation)) throw new Error("PUBLIC_INTERNAL_CITATION_ID_LEAK");

    const publicContext = await publicChat("它解决了什么问题？");
    assertGrounded(publicContext.message, publicContext.trace);
    assertResolved(publicContext.trace, "Askme", "contextual");

    const publicMulti = await publicChat("Askme 和 MoonBase 分别解决了什么问题？");
    assertGrounded(publicMulti.message, publicMulti.trace);
    if (publicMulti.trace.coverage !== "partial" || !publicMulti.message.content.includes("MoonBase")) throw new Error("PUBLIC_PARTIAL_ENTITY_GAP_NOT_EXPLICIT");

    const publicAmbiguous = await publicChat("它解决了什么问题？");
    assertInsufficient(publicAmbiguous.message, publicAmbiguous.trace, "contextual_reference_ambiguous");

    const publicUnknown = await publicChat("MoonBase 怎么样？");
    assertInsufficient(publicUnknown.message, publicUnknown.trace, "strict_entity_missing");

    const traces = [candidateKnown.trace, candidateContext.trace, candidateMulti.trace, candidateAmbiguous.trace, candidateUnknown.trace,
      candidateUnknownDeep.trace, publicKnown.trace, publicContext.trace, publicMulti.trace, publicAmbiguous.trace, publicUnknown.trace];
    if (traces.some((trace) => trace.policyVersion !== expectedPolicyVersion)) throw new Error("POLICY_VERSION_MISMATCH");

    console.info(JSON.stringify({
      event: "rag.api-eval.completed", passed: true, policyVersion: expectedPolicyVersion,
      candidate: { cases: 6, grounded: 3, failedClosed: 3, unknownDeepRunsCreated: 0 },
      public: { cases: 5, grounded: 3, failedClosed: 2, internalCitationIdsExposed: false },
      conversationsCreated: 2,
    }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "rag.api-eval.failed", errorCode: error instanceof Error ? error.message : "UNKNOWN" }));
  process.exitCode = 1;
});
