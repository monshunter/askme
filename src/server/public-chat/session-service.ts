import "server-only";

import type { Pool, PoolClient } from "pg";

import { refreshConversationSuggestions } from "@/server/agent/conversation-suggestions";
import { loadPlatformPolicies } from "@/server/admin/settings-service";
import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { requirePublicAgentContext } from "@/server/publication/public-agent-service";

import { consumePublicRateLimit } from "./rate-limit";
import { createVisitorCredential, hashVisitorToken, validVisitorToken } from "./visitor-credential";

const PUBLIC_SESSION_MS = 30 * 24 * 60 * 60 * 1_000;

export type PublicConversation = {
  id: string;
  ownerId: string;
  publicationId: string;
  expiresAt: Date;
  createdAt: Date;
  lastActivityAt: Date;
};

export type PublicSessionSummary = {
  id: string;
  title: string | null;
  messageCount: number;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
};

function conversationSelection() {
  return `id,owner_id AS "ownerId",publication_id AS "publicationId",expires_at AS "expiresAt",
          created_at AS "createdAt",last_activity_at AS "lastActivityAt"`;
}

async function touchConversation(publicationId: string, tokenHash: string, conversationId: string) {
  const result = await getPool().query<PublicConversation>(
    `UPDATE conversations
     SET last_activity_at=now(),expires_at=now()+interval '30 days'
     WHERE id=$1 AND publication_id=$2 AND mode='public' AND visitor_token_hash=$3 AND expires_at>now()
     RETURNING ${conversationSelection()}`,
    [conversationId, publicationId, tokenHash],
  );
  return result.rows[0] ?? null;
}

async function mostRecentConversation(client: Pool | PoolClient, publicationId: string, tokenHash: string) {
  const result = await client.query<PublicConversation>(
    `SELECT ${conversationSelection()} FROM conversations
     WHERE publication_id=$1 AND mode='public' AND visitor_token_hash=$2 AND expires_at>now()
     ORDER BY last_activity_at DESC,id DESC LIMIT 1`,
    [publicationId, tokenHash],
  );
  return result.rows[0] ?? null;
}

async function insertConversation(
  client: PoolClient,
  publication: Awaited<ReturnType<typeof requirePublicAgentContext>>,
  tokenHash: string,
  requestId?: string,
) {
  const expiresAt = new Date(Date.now() + PUBLIC_SESSION_MS);
  const conversationResult = await client.query<PublicConversation>(
    `INSERT INTO conversations(owner_id,publication_id,mode,visitor_token_hash,expires_at)
     VALUES ($1,$2,'public',$3,$4)
     RETURNING ${conversationSelection()}`,
    [publication.ownerId, publication.publicationId, tokenHash, expiresAt],
  );
  const conversation = conversationResult.rows[0]!;
  await client.query(
    `INSERT INTO audit_events(actor_role,action,target_type,target_id,outcome,request_id,metadata)
     VALUES ('interviewer','public.session.create','conversation',$1,'created',$2,$3::jsonb)`,
    [conversation.id, requestId ?? null, JSON.stringify({ publicationId: publication.publicationId })],
  );
  return conversation;
}

async function consumeSessionCreationLimit(publicationId: string, clientAddress: string) {
  const policies = await loadPlatformPolicies();
  await consumePublicRateLimit(`session:${publicationId}:${clientAddress}`, policies.publicSessionHourlyLimit, 3_600);
}

export async function openPublicSession(slug: string, visitorToken: string | undefined, clientAddress: string, requestId?: string) {
  const publication = await requirePublicAgentContext(slug);
  const validToken = validVisitorToken(visitorToken);
  const credential = validToken
    ? { token: validToken, tokenHash: hashVisitorToken(validToken) }
    : createVisitorCredential();
  if (validToken) {
    const existing = await mostRecentConversation(getPool(), publication.publicationId, credential.tokenHash);
    if (existing) {
      const touched = await touchConversation(publication.publicationId, credential.tokenHash, existing.id);
      if (touched) return { conversation: touched, token: credential.token, created: false };
    }
  }

  await consumeSessionCreationLimit(publication.publicationId, clientAddress);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${publication.publicationId}:${credential.tokenHash}:bootstrap`]);
    const concurrent = await mostRecentConversation(client, publication.publicationId, credential.tokenHash);
    if (concurrent) {
      await client.query(
        "UPDATE conversations SET last_activity_at=now(),expires_at=now()+interval '30 days' WHERE id=$1",
        [concurrent.id],
      );
      await client.query("COMMIT");
      return { conversation: { ...concurrent, lastActivityAt: new Date(), expiresAt: new Date(Date.now() + PUBLIC_SESSION_MS) }, token: credential.token, created: false };
    }
    const conversation = await insertConversation(client, publication, credential.tokenHash, requestId);
    await client.query("COMMIT");
    return { conversation, token: credential.token, created: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listPublicSessions(slug: string, visitorToken: string | undefined) {
  const publication = await requirePublicAgentContext(slug);
  const token = validVisitorToken(visitorToken);
  if (!token) throw new AppError("PUBLIC_SESSION_REQUIRED", "Start a public Agent session first.", 401);
  const result = await getPool().query<PublicSessionSummary>(
    `SELECT conversation.id,
            (SELECT left(regexp_replace(btrim(message.content),'[[:space:]]+',' ','g'),80)
             FROM messages message WHERE message.conversation_id=conversation.id AND message.owner_id=conversation.owner_id AND message.role='user'
             ORDER BY message.created_at ASC,message.id ASC LIMIT 1) AS title,
            (SELECT count(*)::int FROM messages message WHERE message.conversation_id=conversation.id AND message.owner_id=conversation.owner_id) AS "messageCount",
            conversation.created_at AS "createdAt",conversation.last_activity_at AS "lastActivityAt",conversation.expires_at AS "expiresAt"
     FROM conversations conversation
     WHERE conversation.publication_id=$1 AND conversation.mode='public' AND conversation.visitor_token_hash=$2 AND conversation.expires_at>now()
     ORDER BY conversation.last_activity_at DESC,conversation.id DESC`,
    [publication.publicationId, hashVisitorToken(token)],
  );
  return { sessions: result.rows };
}

export async function createPublicSession(slug: string, visitorToken: string | undefined, clientAddress: string, requestId?: string) {
  const publication = await requirePublicAgentContext(slug);
  const token = validVisitorToken(visitorToken);
  if (!token) throw new AppError("PUBLIC_SESSION_REQUIRED", "Start a public Agent session first.", 401);
  await consumeSessionCreationLimit(publication.publicationId, clientAddress);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const conversation = await insertConversation(client, publication, hashVisitorToken(token), requestId);
    await client.query("COMMIT");
    return { conversation };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePublicSession(slug: string, visitorToken: string | undefined, conversationId: string, requestId?: string) {
  const publication = await requirePublicAgentContext(slug);
  const token = validVisitorToken(visitorToken);
  if (!token) throw new AppError("PUBLIC_SESSION_REQUIRED", "Start a public Agent session first.", 401);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query<{ id: string }>(
      `SELECT id FROM conversations
       WHERE id=$1 AND publication_id=$2 AND mode='public' AND visitor_token_hash=$3 AND expires_at>now() FOR UPDATE`,
      [conversationId, publication.publicationId, hashVisitorToken(token)],
    );
    if (!owned.rows[0]) throw new AppError("PUBLIC_SESSION_NOT_FOUND", "The public Agent session was not found.", 404);
    const activeRun = await client.query(
      "SELECT id FROM analysis_runs WHERE conversation_id=$1 AND state IN ('pending','running') LIMIT 1 FOR UPDATE",
      [conversationId],
    );
    if (activeRun.rows[0]) throw new AppError("PUBLIC_SESSION_BUSY", "Wait for the current deep analysis to finish before deleting this conversation.", 409);
    await client.query("DELETE FROM conversations WHERE id=$1", [conversationId]);
    await client.query(
      `INSERT INTO audit_events(actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ('interviewer','public.session.delete','conversation',$1,'deleted',$2,$3::jsonb)`,
      [conversationId, requestId ?? null, JSON.stringify({ publicationId: publication.publicationId })],
    );
    await client.query("COMMIT");
    return { id: conversationId, deleted: true as const };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function requirePublicConversation(slug: string, visitorToken: string | undefined, conversationId: string) {
  const publication = await requirePublicAgentContext(slug);
  const token = validVisitorToken(visitorToken);
  if (!token) throw new AppError("PUBLIC_SESSION_REQUIRED", "Start a public Agent session first.", 401);
  const conversation = await touchConversation(publication.publicationId, hashVisitorToken(token), conversationId);
  if (!conversation) throw new AppError("PUBLIC_SESSION_NOT_FOUND", "The public Agent session was not found.", 404);
  return { publication, conversation, token };
}

export async function refreshPublicSuggestions(slug: string, visitorToken: string | undefined, conversationId: string, locale: "en" | "zh-CN" = "en") {
  const { conversation, publication } = await requirePublicConversation(slug, visitorToken, conversationId);
  await consumePublicRateLimit(`suggestion:${conversation.id}`, 30, 60);
  const suggestedQuestions = await refreshConversationSuggestions({ conversationId: conversation.id, ownerId: conversation.ownerId, mode: "public", locale });
  return { suggestedQuestions, publicationUpdatedAt: publication.updatedAt };
}
