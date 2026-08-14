import "server-only";

import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { refreshConversationSuggestions } from "@/server/agent/conversation-suggestions";
import { requirePublicAgentContext } from "@/server/publication/public-agent-service";
import { loadPlatformPolicies } from "@/server/admin/settings-service";

import { consumePublicRateLimit } from "./rate-limit";
import { createVisitorCredential, hashVisitorToken, validVisitorToken } from "./visitor-credential";

const PUBLIC_SESSION_MS = 30 * 24 * 60 * 60 * 1_000;

export type PublicConversation = {
  id: string;
  ownerId: string;
  publicationId: string;
  expiresAt: Date;
};

async function touchConversation(publicationId: string, token: string) {
  const result = await getPool().query<PublicConversation>(
    `UPDATE conversations
     SET last_activity_at=now(),expires_at=now()+interval '30 days'
     WHERE publication_id=$1 AND mode='public' AND visitor_token_hash=$2 AND expires_at>now()
     RETURNING id,owner_id AS "ownerId",publication_id AS "publicationId",expires_at AS "expiresAt"`,
    [publicationId, hashVisitorToken(token)],
  );
  return result.rows[0] ?? null;
}

export async function openPublicSession(slug: string, visitorToken: string | undefined, clientAddress: string, requestId?: string) {
  const publication = await requirePublicAgentContext(slug);
  const policies = await loadPlatformPolicies();
  const validToken = validVisitorToken(visitorToken);
  if (validToken) {
    const existing = await touchConversation(publication.publicationId, validToken);
    if (existing) {
      return { conversation: existing, token: validToken, created: false };
    }
  }

  await consumePublicRateLimit(`session:${publication.publicationId}:${clientAddress}`, policies.publicSessionHourlyLimit, 3_600);
  const credential = validToken
    ? { token: validToken, tokenHash: hashVisitorToken(validToken) }
    : createVisitorCredential();
  const expiresAt = new Date(Date.now() + PUBLIC_SESSION_MS);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${publication.publicationId}:${credential.tokenHash}`]);
    const concurrent = validToken ? await client.query<PublicConversation>(
      `UPDATE conversations SET last_activity_at=now(),expires_at=now()+interval '30 days'
       WHERE publication_id=$1 AND mode='public' AND visitor_token_hash=$2 AND expires_at>now()
       RETURNING id,owner_id AS "ownerId",publication_id AS "publicationId",expires_at AS "expiresAt"`,
      [publication.publicationId, credential.tokenHash],
    ) : null;
    if (concurrent?.rows[0]) {
      await client.query("COMMIT");
      return { conversation: concurrent.rows[0], token: credential.token, created: false };
    }
    if (validToken) {
      const stale = await client.query<{ id: string }>(
        "SELECT id FROM conversations WHERE publication_id=$1 AND mode='public' AND visitor_token_hash=$2 LIMIT 1 FOR UPDATE",
        [publication.publicationId, credential.tokenHash],
      );
      if (stale.rows[0]) {
        await client.query(
          "UPDATE conversations SET visitor_token_hash=$2 WHERE id=$1",
          [stale.rows[0].id, createVisitorCredential().tokenHash],
        );
      }
    }
    const conversationResult = await client.query<PublicConversation>(
      `INSERT INTO conversations(owner_id,publication_id,mode,visitor_token_hash,expires_at)
       VALUES ($1,$2,'public',$3,$4)
       RETURNING id,owner_id AS "ownerId",publication_id AS "publicationId",expires_at AS "expiresAt"`,
      [publication.ownerId, publication.publicationId, credential.tokenHash, expiresAt],
    );
    const conversation = conversationResult.rows[0]!;
    await client.query(
      `INSERT INTO audit_events(actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ('interviewer','public.session.create','publication',$1,'created',$2,$3::jsonb)`,
      [publication.publicationId, requestId ?? null, JSON.stringify({ conversationId: conversation.id })],
    );
    await client.query("COMMIT");
    return { conversation, token: credential.token, created: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function requirePublicConversation(slug: string, visitorToken: string | undefined) {
  const publication = await requirePublicAgentContext(slug);
  const token = validVisitorToken(visitorToken);
  if (!token) throw new AppError("PUBLIC_SESSION_REQUIRED", "Start a public Agent session first.", 401);
  const conversation = await touchConversation(publication.publicationId, token);
  if (!conversation) throw new AppError("PUBLIC_SESSION_REQUIRED", "Start a public Agent session first.", 401);
  return { publication, conversation, token };
}

export async function refreshPublicSuggestions(slug: string, visitorToken: string | undefined, locale: "en" | "zh-CN" = "en") {
  const { conversation, publication } = await requirePublicConversation(slug, visitorToken);
  await consumePublicRateLimit(`suggestion:${conversation.id}`, 30, 60);
  const suggestedQuestions = await refreshConversationSuggestions({ conversationId: conversation.id, ownerId: conversation.ownerId, mode: "public", locale });
  return { suggestedQuestions, publicationUpdatedAt: publication.updatedAt };
}
