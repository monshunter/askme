import type { Pool, PoolClient } from "pg";

export type RetentionFacts = {
  active: boolean;
  dossier: boolean;
  run: boolean;
  messageCitation: boolean;
};

export function repositoryRevisionRetentionReasons(facts: RetentionFacts) {
  return [
    facts.active ? "active" : null,
    facts.dossier ? "dossier" : null,
    facts.run ? "run" : null,
    facts.messageCitation ? "message_citation" : null,
  ].filter((reason): reason is string => reason !== null);
}

type RevisionCandidate = {
  id: string;
  artifactKey: string;
  active: boolean;
  dossier: boolean;
  run: boolean;
  messageCitation: boolean;
};

async function withTransaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await action(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function releaseUnreferencedRepositoryRevisions(
  pool: Pool,
  options: { storedBefore: Date; limit?: number },
) {
  return withTransaction(pool, async (client) => {
    const candidates = await client.query<RevisionCandidate>(
      `SELECT revision.id,revision.artifact_key AS "artifactKey",
              (repository.active_revision_id=revision.id) AS active,
              EXISTS(SELECT 1 FROM repository_dossiers dossier WHERE dossier.revision_id=revision.id) AS dossier,
              EXISTS(SELECT 1 FROM analysis_runs run WHERE run.revision_id=revision.id) AS run,
              EXISTS(SELECT 1 FROM repository_message_citations citation WHERE citation.revision_id=revision.id) AS "messageCitation"
       FROM repository_revisions revision
       JOIN repositories repository ON repository.id=revision.repository_id AND repository.owner_id=revision.owner_id
       WHERE revision.state='stored' AND revision.artifact_key IS NOT NULL AND revision.stored_at < $1
       ORDER BY revision.stored_at,revision.id
       FOR UPDATE OF revision SKIP LOCKED
       LIMIT $2`,
      [options.storedBefore, options.limit ?? 100],
    );
    const released: string[] = [];
    for (const candidate of candidates.rows) {
      if (repositoryRevisionRetentionReasons(candidate).length > 0) continue;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [candidate.artifactKey]);
      const current = await client.query<RetentionFacts>(
        `SELECT
           EXISTS(SELECT 1 FROM repositories WHERE active_revision_id=$1) AS active,
           EXISTS(SELECT 1 FROM repository_dossiers WHERE revision_id=$1) AS dossier,
           EXISTS(SELECT 1 FROM analysis_runs WHERE revision_id=$1) AS run,
           EXISTS(SELECT 1 FROM repository_message_citations WHERE revision_id=$1) AS "messageCitation"`,
        [candidate.id],
      );
      if (repositoryRevisionRetentionReasons(current.rows[0]!).length > 0) continue;
      const updated = await client.query(
        `UPDATE repository_revisions
         SET state='collected',artifact_key=NULL,updated_at=now()
         WHERE id=$1 AND state='stored' AND artifact_key=$2`,
        [candidate.id, candidate.artifactKey],
      );
      if (updated.rowCount !== 1) continue;
      await client.query(
        `UPDATE repository_artifacts SET
           reference_count=greatest(reference_count-1,0),
           gc_eligible_at=CASE WHEN reference_count<=1 THEN greatest(coalesce(retention_until,now()),now()) ELSE gc_eligible_at END,
           gc_error_code=NULL
         WHERE content_key=$1`,
        [candidate.artifactKey],
      );
      released.push(candidate.id);
    }
    return released;
  });
}

export type ArtifactGcClaim = { contentKey: string; storagePath: string; leaseOwner: string };

export async function claimRepositoryArtifactsForGc(
  pool: Pool,
  options: { leaseOwner: string; now?: Date; leaseMs?: number; limit?: number },
) {
  const now = options.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + (options.leaseMs ?? 60_000));
  return withTransaction(pool, async (client) => {
    const claimed = await client.query<{ contentKey: string; storagePath: string }>(
      `WITH candidates AS (
         SELECT artifact.content_key
         FROM repository_artifacts artifact
         WHERE artifact.reference_count=0
           AND artifact.gc_eligible_at IS NOT NULL AND artifact.gc_eligible_at <= $1
           AND (artifact.gc_lease_expires_at IS NULL OR artifact.gc_lease_expires_at <= $1)
           AND NOT EXISTS(SELECT 1 FROM repository_revisions revision WHERE revision.artifact_key=artifact.content_key)
         ORDER BY artifact.gc_eligible_at,artifact.content_key
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE repository_artifacts artifact SET
         gc_lease_owner=$3,gc_lease_expires_at=$4,gc_error_code=NULL
       FROM candidates
       WHERE artifact.content_key=candidates.content_key
       RETURNING artifact.content_key AS "contentKey",artifact.storage_path AS "storagePath"`,
      [now, options.limit ?? 100, options.leaseOwner, leaseExpiresAt],
    );
    return claimed.rows.map((row): ArtifactGcClaim => ({ ...row, leaseOwner: options.leaseOwner }));
  });
}

export async function collectClaimedRepositoryArtifact(
  pool: Pool,
  storage: { remove(contentKey: string, storagePath: string): Promise<void> },
  claim: ArtifactGcClaim,
) {
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [claim.contentKey]);
    const current = await client.query<{ storagePath: string; referenceCount: number; validLease: boolean; revisionReference: boolean }>(
      `SELECT artifact.storage_path AS "storagePath",artifact.reference_count AS "referenceCount",
              (artifact.gc_lease_owner=$2 AND artifact.gc_lease_expires_at>now()) AS "validLease",
              EXISTS(SELECT 1 FROM repository_revisions revision WHERE revision.artifact_key=artifact.content_key) AS "revisionReference"
       FROM repository_artifacts artifact WHERE artifact.content_key=$1 FOR UPDATE`,
      [claim.contentKey, claim.leaseOwner],
    );
    const artifact = current.rows[0];
    if (!artifact || !artifact.validLease || artifact.referenceCount !== 0 || artifact.revisionReference || artifact.storagePath !== claim.storagePath) return false;
    try {
      await storage.remove(claim.contentKey, claim.storagePath);
      await client.query("DELETE FROM repository_artifacts WHERE content_key=$1", [claim.contentKey]);
      return true;
    } catch {
      await client.query(
        `UPDATE repository_artifacts SET
           gc_lease_owner=NULL,gc_lease_expires_at=NULL,gc_eligible_at=now()+interval '5 minutes',gc_error_code='ARTIFACT_DELETE_FAILED'
         WHERE content_key=$1`,
        [claim.contentKey],
      );
      return false;
    }
  });
}
