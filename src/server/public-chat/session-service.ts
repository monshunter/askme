import "server-only";

import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { loadPublicSuggestedQuestions, requirePublicAgentContext } from "@/server/publication/public-agent-service";

import { consumePublicRateLimit } from "./rate-limit";
import { createVisitorCredential, hashVisitorToken, validVisitorToken } from "./visitor-credential";

const PUBLIC_SESSION_MS = 24 * 60 * 60 * 1_000;

export type PublicConversation = {
  id: string;
  ownerId: string;
  publicationId: string;
  expiresAt: Date;
};

async function findConversation(publicationId: string, token: string) {
  const result = await getPool().query<PublicConversation>(
    `SELECT id,owner_id AS "ownerId",publication_id AS "publicationId",expires_at AS "expiresAt"
     FROM conversations
     WHERE publication_id=$1 AND mode='public' AND visitor_token_hash=$2 AND expires_at>now()
     LIMIT 1`,
    [publicationId, hashVisitorToken(token)],
  );
  return result.rows[0] ?? null;
}

export async function openPublicSession(slug: string, visitorToken: string | undefined, clientAddress: string, requestId?: string) {
  const publication = await requirePublicAgentContext(slug);
  const validToken = validVisitorToken(visitorToken);
  if (validToken) {
    const existing = await findConversation(publication.publicationId, validToken);
    if (existing) {
      await getPool().query("UPDATE conversations SET last_activity_at=now() WHERE id=$1", [existing.id]);
      return { conversation: existing, token: validToken, created: false };
    }
  }

  await consumePublicRateLimit(`session:${publication.publicationId}:${clientAddress}`, 20, 3_600);
  const credential = createVisitorCredential();
  const expiresAt = new Date(Date.now() + PUBLIC_SESSION_MS);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
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
  const conversation = await findConversation(publication.publicationId, token);
  if (!conversation) throw new AppError("PUBLIC_SESSION_REQUIRED", "Start a public Agent session first.", 401);
  return { publication, conversation, token };
}

export async function refreshPublicSuggestions(slug: string, visitorToken: string | undefined) {
  const { conversation, publication } = await requirePublicConversation(slug, visitorToken);
  await consumePublicRateLimit(`suggestion:${conversation.id}`, 30, 60);
  const result = await getPool().query<{ suggestionCursor: number }>(
    `UPDATE conversations SET suggestion_cursor=(suggestion_cursor+1)%1000000,last_activity_at=now()
     WHERE id=$1 AND owner_id=$2 RETURNING suggestion_cursor AS "suggestionCursor"`,
    [conversation.id, conversation.ownerId],
  );
  return { suggestedQuestions: await loadPublicSuggestedQuestions(conversation.ownerId, result.rows[0]!.suggestionCursor), publicationUpdatedAt: publication.updatedAt };
}
