import "server-only";

import type { PoolClient } from "pg";

import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";

import { createPublicSlug, evaluatePublishReadiness, type PublishReadinessFacts } from "./publication-policy";

type PublicationRecord = {
  id: string;
  slug: string;
  status: "draft" | "published" | "revoked" | "paused";
  publishedAt: Date | null;
  revokedAt: Date | null;
  pausedAt: Date | null;
  pauseReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type OverviewFacts = PublishReadinessFacts & {
  publicMode: boolean;
  publicEvidence: number;
};

const publicationProjection = `id,slug,status,published_at AS "publishedAt",revoked_at AS "revokedAt",
  paused_at AS "pausedAt",pause_reason AS "pauseReason",created_at AS "createdAt",updated_at AS "updatedAt"`;

async function readFacts(ownerId: string, client: Pick<PoolClient, "query"> = getPool()) {
  const result = await client.query<OverviewFacts>(
    `SELECT user_account.display_name AS "displayName",user_account.headline,
            (SELECT count(*)::int FROM materials WHERE owner_id=$1 AND status='indexed') AS "indexedMaterials",
            coalesce(policy.revision,1)::int AS "policyRevision",confirmation.policy_revision::int AS "confirmedRevision",
            coalesce(settings.public_mode,false) AS "publicMode",
            (SELECT count(*)::int FROM materials WHERE owner_id=$1 AND status='indexed' AND visibility IN ('citation_allowed','public_preview')) AS "publicEvidence"
     FROM users user_account
     LEFT JOIN privacy_policy_states policy ON policy.owner_id=user_account.id
     LEFT JOIN privacy_confirmations confirmation ON confirmation.owner_id=user_account.id
     LEFT JOIN agent_settings settings ON settings.owner_id=user_account.id
     WHERE user_account.id=$1`,
    [ownerId],
  );
  if (!result.rows[0]) throw new AppError("USER_NOT_FOUND", "The Candidate account was not found.", 404);
  return result.rows[0];
}

async function activePublication(ownerId: string, client: Pick<PoolClient, "query"> = getPool()) {
  const result = await client.query<PublicationRecord>(
    `SELECT ${publicationProjection} FROM publications
     WHERE owner_id=$1 AND status IN ('draft','published','paused')
     ORDER BY created_at DESC,id DESC LIMIT 1`,
    [ownerId],
  );
  return result.rows[0] ?? null;
}

export async function loadPublicationOverview(ownerId: string) {
  const [facts, publication] = await Promise.all([readFacts(ownerId), activePublication(ownerId)]);
  return {
    publication,
    readiness: evaluatePublishReadiness(facts),
    publicMode: facts.publicMode,
    publicEvidence: facts.publicEvidence,
  };
}

async function lockOwner(client: PoolClient, ownerId: string) {
  const result = await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [ownerId]);
  if (!result.rows[0]) throw new AppError("USER_NOT_FOUND", "The Candidate account was not found.", 404);
}

async function insertPublication(client: PoolClient, ownerId: string, status: "draft" | "published") {
  for (;;) {
    const slug = createPublicSlug();
    const result = await client.query<PublicationRecord>(
      `INSERT INTO publications(owner_id,slug,status,published_at)
       VALUES ($1,$2,$3::publication_status,CASE WHEN $3::publication_status='published'::publication_status THEN now() ELSE NULL END)
       ON CONFLICT DO NOTHING
       RETURNING ${publicationProjection}`,
      [ownerId, slug, status],
    );
    if (result.rows[0]) return result.rows[0];
  }
}

async function auditPublication(client: PoolClient, ownerId: string, publication: PublicationRecord, action: string, outcome: string, requestId?: string) {
  await client.query(
    `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
     VALUES ($1,'candidate',$2,'publication',$3,$4,$5,$6::jsonb)`,
    [ownerId, action, publication.id, outcome, requestId ?? null, JSON.stringify({ status: publication.status })],
  );
}

export async function publishAgent(ownerId: string, requestId?: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await lockOwner(client, ownerId);
    const current = await activePublication(ownerId, client);
    if (current?.status === "paused") throw new AppError("PUBLICATION_PAUSED", "This Agent is paused by platform governance and cannot be republished by the Candidate.", 409);
    if (current?.status === "published") {
      const facts = await readFacts(ownerId, client);
      if (!facts.publicMode) {
        await client.query(
          `INSERT INTO agent_settings(owner_id,public_mode) VALUES ($1,true)
           ON CONFLICT (owner_id) DO UPDATE SET public_mode=true,updated_at=now()`,
          [ownerId],
        );
      }
      await auditPublication(client, ownerId, current, "publication.publish", facts.publicMode ? "unchanged" : "enabled", requestId);
      await client.query("COMMIT");
      return { publication: current, changed: !facts.publicMode };
    }
    const facts = await readFacts(ownerId, client);
    const readiness = evaluatePublishReadiness(facts);
    if (!readiness.ready) {
      throw new AppError("PUBLISH_NOT_READY", "Complete every publishing requirement first.", 409, {
        failedChecks: readiness.checks.filter((check) => !check.ready).map((check) => check.key),
      });
    }
    let publication: PublicationRecord;
    if (current) {
      const updated = await client.query<PublicationRecord>(
        `UPDATE publications SET status='published',published_at=now(),updated_at=now()
         WHERE id=$1 AND owner_id=$2 AND status='draft' RETURNING ${publicationProjection}`,
        [current.id, ownerId],
      );
      publication = updated.rows[0]!;
    } else {
      publication = await insertPublication(client, ownerId, "published");
    }
    await client.query(
      `INSERT INTO agent_settings(owner_id,public_mode) VALUES ($1,true)
       ON CONFLICT (owner_id) DO UPDATE SET public_mode=true,updated_at=now()`,
      [ownerId],
    );
    await auditPublication(client, ownerId, publication, "publication.publish", "published", requestId);
    await client.query("COMMIT");
    return { publication, changed: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeAgent(ownerId: string, requestId?: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await lockOwner(client, ownerId);
    const current = await activePublication(ownerId, client);
    if (!current) throw new AppError("PUBLICATION_NOT_ACTIVE", "There is no active Agent link to revoke.", 409);
    const updated = await client.query<PublicationRecord>(
      `UPDATE publications SET status='revoked',revoked_at=now(),updated_at=now()
       WHERE id=$1 AND owner_id=$2 RETURNING ${publicationProjection}`,
      [current.id, ownerId],
    );
    const publication = updated.rows[0]!;
    await client.query("UPDATE agent_settings SET public_mode=false,updated_at=now() WHERE owner_id=$1", [ownerId]);
    await auditPublication(client, ownerId, publication, "publication.revoke", "revoked", requestId);
    await client.query("COMMIT");
    return { publication, changed: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
