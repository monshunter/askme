import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { z } from "zod";

const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.ASKME_CANDIDATE_EMAIL ?? "candidate@askme.local";
const password = process.env.ASKME_CANDIDATE_PASSWORD ?? "Candidate-local-2026!";
const expectedPolicyVersion = "query-understood-rag-v4";

const traceSchema = z.object({
  policyVersion: z.string(),
  coverage: z.enum(["full", "partial", "none", "conflicted"]),
  roundCount: z.number().int().nonnegative(),
  selectedEvidence: z.array(z.record(z.string(), z.unknown())),
  planner: z.object({
    intent: z.string(),
    subject: z.string(),
    queryMode: z.string(),
    knowledgeScope: z.string(),
    requestedFields: z.array(z.string()),
    adjudication: z.object({ applied: z.boolean(), reasonCode: z.string().nullable() }),
    entityResolution: z.object({
      mentions: z.array(z.object({ text: z.string(), type: z.string(), source: z.string(), role: z.string() })),
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

function assertDiscovery(trace: Trace, requestedFields: string[]) {
  if (trace.planner.queryMode !== "discovery" || trace.planner.subject !== "profile_owner") throw new Error(`DISCOVERY_SEMANTICS:${trace.planner.queryMode}:${trace.planner.subject}`);
  if (trace.planner.entityResolution.mentions.some((mention) => mention.role === "required")) throw new Error("DISCOVERY_REQUIRED_ENTITY_FALSE_POSITIVE");
  if (requestedFields.some((field) => !trace.planner.requestedFields.includes(field))) throw new Error(`DISCOVERY_REQUESTED_FIELDS:${trace.planner.requestedFields.join(",")}`);
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
    const profilePublication = await pool.query<{ ownerId: string; slug: string }>(
      `SELECT publication.owner_id AS "ownerId",publication.slug
       FROM publications publication
       WHERE publication.status='published' AND EXISTS (
         SELECT 1 FROM knowledge_items knowledge
         WHERE knowledge.owner_id=publication.owner_id AND knowledge.status='active'
           AND knowledge.entities::text ILIKE '%富途%'
       )
       ORDER BY publication.published_at DESC LIMIT 1`,
    );
    const profileOwnerId = requireValue(profilePublication.rows[0]?.ownerId, "PROFILE_PUBLICATION_NOT_FOUND");
    const profileSlug = requireValue(profilePublication.rows[0]?.slug, "PROFILE_PUBLICATION_NOT_FOUND");

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    if (!login.ok || !cookie) throw new Error(`LOGIN_FAILED:${login.status}`);

    const inserted = await pool.query<{ id: string }>("INSERT INTO conversations(owner_id,mode) VALUES ($1,'preview') RETURNING id", [ownerId]);
    const candidateConversationId = requireValue(inserted.rows[0]?.id, "PREVIEW_CONVERSATION_CREATE_FAILED");
    const traceFromMessage = async (message: Message, traceOwnerId = ownerId) => {
      if (message.retrievalTrace) return traceSchema.parse(message.retrievalTrace);
      const result = await pool.query<{ trace: unknown }>(
        `SELECT jsonb_build_object('policyVersion',policy_version,'coverage',coverage,'roundCount',round_count,
           'selectedEvidence',selected_evidence,'planner',planner) AS trace
         FROM rag_query_traces WHERE owner_id=$1 AND message_id=$2`,
        [traceOwnerId, message.id],
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

    const candidateProjects = await candidateChat("你做过哪些项目？");
    assertGrounded(candidateProjects.message, candidateProjects.trace);
    assertDiscovery(candidateProjects.trace, ["project_name"]);

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
    if (!candidateUnknown.trace.planner.adjudication.applied || candidateUnknown.trace.planner.adjudication.reasonCode !== "entity_hard_stop") throw new Error("UNKNOWN_ENTITY_NOT_ADJUDICATED");

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

    const publicProjects = await publicChat("你做过哪些项目？");
    assertGrounded(publicProjects.message, publicProjects.trace);
    assertDiscovery(publicProjects.trace, ["project_name"]);

    const publicMulti = await publicChat("Askme 和 MoonBase 分别解决了什么问题？");
    assertGrounded(publicMulti.message, publicMulti.trace);
    if (publicMulti.trace.coverage !== "partial" || !publicMulti.message.content.includes("MoonBase")) throw new Error("PUBLIC_PARTIAL_ENTITY_GAP_NOT_EXPLICIT");

    const publicAmbiguous = await publicChat("它解决了什么问题？");
    assertInsufficient(publicAmbiguous.message, publicAmbiguous.trace, "contextual_reference_ambiguous");

    const publicUnknown = await publicChat("MoonBase 怎么样？");
    assertInsufficient(publicUnknown.message, publicUnknown.trace, "strict_entity_missing");

    const profileAddress = `198.51.100.${Math.floor(Math.random() * 180) + 20}`;
    const profileSession = await request<{ visitorToken: string; conversationId: string }>(`/api/public/agents/${profileSlug}/session`, {
      method: "POST", headers: { "x-forwarded-for": profileAddress, "accept-language": "zh-CN" },
    });
    const profileHeaders = { "x-forwarded-for": profileAddress, "x-askme-visitor-token": profileSession.visitorToken, "content-type": "application/json", "accept-language": "zh-CN" };
    const profileChat = async (question: string) => {
      const thread = await request<Thread>(`/api/public/agents/${profileSlug}/chat`, {
        method: "POST", headers: profileHeaders,
        body: JSON.stringify({ clientMessageId: randomUUID(), conversationId: profileSession.conversationId, question }),
      });
      if (thread.analysisRun) throw new Error(`UNEXPECTED_PROFILE_DEEP_RUN:${question}`);
      const message = assistant(thread);
      return { message, trace: await traceFromMessage(message, profileOwnerId) };
    };

    const profileEmployment = await profileChat("2022年到2024年，你在哪家公司任职，担任什么职务，负责什么工作内容？");
    assertGrounded(profileEmployment.message, profileEmployment.trace);
    assertDiscovery(profileEmployment.trace, ["company", "job_title", "responsibilities"]);

    const profileIncidental = await profileChat("看过 Askme 后，我还做过哪些项目？");
    assertGrounded(profileIncidental.message, profileIncidental.trace);
    assertDiscovery(profileIncidental.trace, ["project_name"]);
    if (!profileIncidental.trace.planner.entityResolution.mentions.some((mention) => mention.text === "Askme" && mention.role === "context")) throw new Error("INCIDENTAL_ENTITY_ROLE");

    const profileFocused = await profileChat("你在富途控股负责什么工作？");
    assertGrounded(profileFocused.message, profileFocused.trace);
    assertResolved(profileFocused.trace, "富途控股", "explicit");
    if (!profileFocused.trace.planner.entityResolution.mentions.some((mention) => mention.text === "富途控股" && mention.role === "required")) throw new Error("FOCUSED_ENTITY_ROLE");

    const traces = [candidateKnown.trace, candidateProjects.trace, candidateContext.trace, candidateMulti.trace, candidateAmbiguous.trace, candidateUnknown.trace,
      candidateUnknownDeep.trace, publicKnown.trace, publicProjects.trace, publicContext.trace, publicMulti.trace, publicAmbiguous.trace, publicUnknown.trace,
      profileEmployment.trace, profileIncidental.trace, profileFocused.trace];
    if (traces.some((trace) => trace.policyVersion !== expectedPolicyVersion)) throw new Error("POLICY_VERSION_MISMATCH");

    console.info(JSON.stringify({
      event: "rag.api-eval.completed", passed: true, policyVersion: expectedPolicyVersion,
      candidate: { cases: 7, grounded: 4, failedClosed: 3, unknownDeepRunsCreated: 0 },
      public: { cases: 6, grounded: 4, failedClosed: 2, internalCitationIdsExposed: false },
      publicProfile: { cases: 3, grounded: 3, incidentalEntityRequired: false, focusedEntityRequired: true },
      conversationsCreated: 3,
    }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "rag.api-eval.failed", errorCode: error instanceof Error ? error.message : "UNKNOWN" }));
  process.exitCode = 1;
});
