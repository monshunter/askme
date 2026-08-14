import { randomUUID } from "node:crypto";

import { Client } from "pg";

import { hashPassword } from "../src/server/auth/crypto";

const databaseUrl = process.env.DATABASE_URL;
const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";
if (!databaseUrl) throw new Error("DATABASE_URL is required");

type PreviewThread = {
  conversation?: { id?: string };
  messages?: Array<{ id?: string }>;
  suggestedQuestions?: string[];
  resetCount?: number;
};

const db = new Client({ connectionString: databaseUrl });
const ownerId = randomUUID();
const otherOwnerId = randomUUID();
const conversationId = randomUUID();
const otherConversationId = randomUUID();
const userMessageId = randomUUID();
const assistantMessageId = randomUUID();
const pendingAssistantMessageId = randomUUID();
const otherMessageId = randomUUID();
const materialId = randomUUID();
const chunkId = randomUUID();
const knowledgeItemId = randomUUID();
const email = `${ownerId}@local.invalid`;
const password = "Agent-preview-reset-smoke-2026!";

await db.connect();
try {
  const passwordHash = await hashPassword(password);
  await db.query(
    `INSERT INTO users(id,email,password_hash,role,display_name,headline) VALUES
       ($1,$2,$3,'candidate','Reset Smoke Candidate','Agent Engineer'),
       ($4,$5,$3,'candidate','Other Candidate','Platform Engineer')`,
    [ownerId, email, passwordHash, otherOwnerId, `${otherOwnerId}@local.invalid`],
  );
  await db.query(
    "INSERT INTO agent_settings(owner_id,answer_tone,public_mode,privacy_safe_mode) VALUES ($1,'concise',true,false)",
    [ownerId],
  );
  await db.query(
    `INSERT INTO materials(id,owner_id,kind,title,storage_path,status,visibility,summary,indexed_at)
     VALUES ($1,$2,'file','Reset-safe knowledge',$3,'indexed','citation_allowed','Knowledge must survive preview reset.',now())`,
    [materialId, ownerId, `${ownerId}/${materialId}/reset.md`],
  );
  await db.query(
    "INSERT INTO chunks(id,material_id,owner_id,position,content,token_estimate) VALUES ($1,$2,$3,0,'Reset-safe evidence.',4)",
    [chunkId, materialId, ownerId],
  );
  await db.query(
    `INSERT INTO knowledge_items(id,owner_id,type,title,summary,highlights,confidence)
     VALUES ($1,$2,'project','Reset-safe knowledge','Knowledge must survive preview reset.','[]'::jsonb,1)`,
    [knowledgeItemId, ownerId],
  );
  await db.query("INSERT INTO knowledge_evidence(knowledge_item_id,chunk_id,owner_id) VALUES ($1,$2,$3)", [knowledgeItemId, chunkId, ownerId]);
  await db.query(
    "INSERT INTO conversations(id,owner_id,mode) VALUES ($1,$2,'preview'),($3,$4,'preview')",
    [conversationId, ownerId, otherConversationId, otherOwnerId],
  );
  await db.query(
    `INSERT INTO messages(id,conversation_id,owner_id,role,status,client_message_id,content) VALUES
       ($1,$2,$3,'user','completed',$4,'What did this Agent deliver?'),
       ($5,$6,$7,'user','completed',$8,'Other owner message')`,
    [userMessageId, conversationId, ownerId, randomUUID(), otherMessageId, otherConversationId, otherOwnerId, randomUUID()],
  );
  await db.query(
    `INSERT INTO messages(id,conversation_id,owner_id,role,status,reply_to_message_id,content)
     VALUES
       ($1,$2,$3,'assistant','completed',$4,'A resettable grounded answer.'),
       ($5,$2,$3,'assistant','pending',NULL,'')`,
    [assistantMessageId, conversationId, ownerId, userMessageId, pendingAssistantMessageId],
  );
  await db.query(
    "INSERT INTO message_citations(message_id,chunk_id,owner_id,rank,excerpt) VALUES ($1,$2,$3,1,'Reset-safe evidence.')",
    [assistantMessageId, chunkId, ownerId],
  );
  await db.query(
    "INSERT INTO ai_usage(owner_id,purpose,model,outcome) VALUES ($1,'agent.preview','smoke-model','success')",
    [ownerId],
  );
  await db.query(
    `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome)
     VALUES ($1,'candidate','agent.preview.answer','message',$2,'answered')`,
    [ownerId, assistantMessageId],
  );

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  if (!login.ok || !cookie) throw new Error(`Agent preview reset login failed with ${login.status}`);

  const busyResetResponse = await fetch(`${baseUrl}/api/agent/preview`, { method: "DELETE", headers: { cookie } });
  const busyResetPayload = await busyResetResponse.json() as { error?: { code?: string } };
  if (busyResetResponse.status !== 409 || busyResetPayload.error?.code !== "PREVIEW_SESSION_BUSY") {
    throw new Error(`Preview reset did not protect a pending answer: ${busyResetResponse.status}:${busyResetPayload.error?.code ?? "unknown"}`);
  }
  await db.query("DELETE FROM messages WHERE id=$1 AND owner_id=$2", [pendingAssistantMessageId, ownerId]);

  const resetResponse = await fetch(`${baseUrl}/api/agent/preview`, { method: "DELETE", headers: { cookie } });
  const resetPayload = await resetResponse.json() as { data?: PreviewThread; error?: { code?: string } };
  const reset = resetPayload.data;
  if (!resetResponse.ok || !reset?.conversation?.id || reset.conversation.id === conversationId || reset.resetCount !== 1 || reset.messages?.length !== 0 || reset.suggestedQuestions?.length !== 4) {
    throw new Error(`Preview reset did not return one fresh empty conversation: ${resetResponse.status}:${resetPayload.error?.code ?? "unknown"}`);
  }

  const settingsResponse = await fetch(`${baseUrl}/api/agent/settings`, { headers: { cookie } });
  const settingsPayload = await settingsResponse.json() as { data?: { answerTone?: string; publicMode?: boolean; privacySafeMode?: boolean } };
  if (!settingsResponse.ok || settingsPayload.data?.answerTone !== "concise" || settingsPayload.data.publicMode !== true || settingsPayload.data.privacySafeMode !== false) {
    throw new Error("Preview reset changed persisted Agent settings");
  }

  const page = await fetch(`${baseUrl}/workspace/agent`, { headers: { cookie } });
  const pageHtml = await page.text();
  if (!page.ok || !pageHtml.includes("Reset conversation")) {
    throw new Error("Candidate Agent page did not render the reset action");
  }

  const facts = await db.query<{
    conversations: number;
    oldConversations: number;
    messages: number;
    citations: number;
    knowledgeItems: number;
    usage: number;
    audits: number;
    otherConversations: number;
    otherMessages: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM conversations WHERE owner_id=$1 AND mode='preview') AS conversations,
       (SELECT count(*)::int FROM conversations WHERE id=$2 AND owner_id=$1) AS "oldConversations",
       (SELECT count(*)::int FROM messages WHERE owner_id=$1) AS messages,
       (SELECT count(*)::int FROM message_citations WHERE owner_id=$1) AS citations,
       (SELECT count(*)::int FROM knowledge_items WHERE owner_id=$1) AS "knowledgeItems",
       (SELECT count(*)::int FROM ai_usage WHERE owner_id=$1 AND purpose='agent.preview') AS usage,
       (SELECT count(*)::int FROM audit_events WHERE actor_id=$1 AND action IN ('agent.preview.answer','agent.preview.reset')) AS audits,
       (SELECT count(*)::int FROM conversations WHERE owner_id=$3 AND mode='preview') AS "otherConversations",
       (SELECT count(*)::int FROM messages WHERE owner_id=$3) AS "otherMessages"`,
    [ownerId, conversationId, otherOwnerId],
  );
  const row = facts.rows[0];
  if (!row || row.conversations !== 1 || row.oldConversations !== 0 || row.messages !== 0 || row.citations !== 0 || row.knowledgeItems !== 1 || row.usage !== 1 || row.audits !== 2 || row.otherConversations !== 1 || row.otherMessages !== 1) {
    throw new Error(`Preview reset persistence is inconsistent: ${JSON.stringify(row)}`);
  }

  console.log(JSON.stringify({
    event: "smoke.agent-preview-reset.completed",
    pendingAnswerGuard: true,
    resetCount: reset.resetCount,
    freshConversation: true,
    cascadingMessages: true,
    ownerIsolation: true,
    settingsRetained: true,
    knowledgeRetained: true,
    usageRetained: true,
    auditRetained: true,
    pageRendered: true,
  }));
} finally {
  await db.query("DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[])", [[ownerId, otherOwnerId]]).catch(() => undefined);
  await db.query("DELETE FROM ai_usage WHERE owner_id=ANY($1::uuid[])", [[ownerId, otherOwnerId]]).catch(() => undefined);
  await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[ownerId, otherOwnerId]]).catch(() => undefined);
  await db.end();
}
