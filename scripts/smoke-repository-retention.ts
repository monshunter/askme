import { randomUUID } from "node:crypto";

import { Pool } from "pg";

import {
  claimRepositoryArtifactsForGc,
  collectClaimedRepositoryArtifact,
  releaseUnreferencedRepositoryRevisions,
} from "../src/server/repositories/artifact-retention";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString });
const ownerId = randomUUID();
const repositoryId = randomUUID();
const conversationId = randomUUID();
const messageId = randomUUID();
const revisionIds = Array.from({ length: 5 }, () => randomUUID());
const artifactKeys = Array.from({ length: 5 }, (_, index) => String(index + 1).repeat(64));
const removed: string[] = [];

try {
  await pool.query("INSERT INTO users(id,email,password_hash,role,display_name) VALUES ($1,$2,'fixture','candidate','Retention fixture')", [ownerId, `repository-retention-${ownerId}@example.test`]);
  // The active FK is deferred, so create repository and revisions in one explicit transaction.
  await pool.query("BEGIN");
  await pool.query(
    `INSERT INTO repositories(id,owner_id,canonical_url,display_name,visibility,active_revision_id)
     VALUES ($1,$2,'https://github.com/example/retention','example/retention','private',$3)`,
    [repositoryId, ownerId, revisionIds[0]],
  );
  for (let index = 0; index < artifactKeys.length; index += 1) {
    await pool.query(
      `INSERT INTO repository_artifacts(content_key,checksum,manifest_checksum,storage_path,compressed_bytes,extracted_bytes,file_count,reference_count,retention_until)
       VALUES ($1,$1,$2,$3,1,1,1,1,now()-interval '1 day')`,
      [artifactKeys[index], "f".repeat(64), `${artifactKeys[index]!.slice(0, 2)}/${artifactKeys[index]}.tar.zst`],
    );
    await pool.query(
      `INSERT INTO repository_revisions(
         id,repository_id,owner_id,requested_ref,commit_sha,archive_checksum,artifact_key,filter_fingerprint,
         archive_bytes,extracted_bytes,file_count,state,stored_at,created_at,updated_at
       ) VALUES ($1,$2,$3,'main',$4,$5,$6,$7,1,1,1,'stored',now()-interval '30 days',now()-interval '30 days',now()-interval '30 days')`,
      [revisionIds[index], repositoryId, ownerId, String(index + 1).repeat(40), "e".repeat(64), artifactKeys[index], "d".repeat(63) + String(index)],
    );
  }
  await pool.query("COMMIT");
  await pool.query(
    `INSERT INTO repository_dossiers(
       repository_id,revision_id,owner_id,generated_version,analysis_generation,state,coverage,
       image_digest,skill_hash,prompt_version,profile_fingerprint,configured_model
     ) VALUES ($1,$2,$3,1,0,'review_pending','{}','sha256:image',$4,'v1',$5,'model')`,
    [repositoryId, revisionIds[1], ownerId, "a".repeat(64), "b".repeat(64)],
  );
  await pool.query(
    `INSERT INTO analysis_runs(
       owner_id,purpose,repository_id,revision_id,idempotency_key,state,image_digest,skill_hash,prompt_version,profile_id,profile_fingerprint,configured_model
     ) VALUES ($1,'repository_analysis',$2,$3,$4,'pending','sha256:image',$5,'v1','code',$6,'retention-smoke-model')`,
    [ownerId, repositoryId, revisionIds[2], "c".repeat(64), "a".repeat(64), "b".repeat(64)],
  );
  await pool.query("INSERT INTO conversations(id,owner_id,mode) VALUES ($1,$2,'preview')", [conversationId, ownerId]);
  await pool.query("INSERT INTO messages(id,conversation_id,owner_id,role,status,content) VALUES ($1,$2,$3,'assistant','completed','fixture')", [messageId, conversationId, ownerId]);
  await pool.query(
    `INSERT INTO repository_message_citations(message_id,owner_id,repository_id,revision_id,rank,path,line_start,line_end,content_hash)
     VALUES ($1,$2,$3,$4,1,'README.md',1,1,$5)`,
    [messageId, ownerId, repositoryId, revisionIds[3], "a".repeat(64)],
  );

  const firstRelease = await releaseUnreferencedRepositoryRevisions(pool, { storedBefore: new Date() });
  if (firstRelease.length !== 1 || firstRelease[0] !== revisionIds[4]) throw new Error(`Expected only the unreferenced revision to release, got ${firstRelease.join(",")}`);

  await pool.query("UPDATE repositories SET active_revision_id=NULL WHERE id=$1", [repositoryId]);
  await pool.query("DELETE FROM repository_dossiers WHERE revision_id=$1", [revisionIds[1]]);
  await pool.query("DELETE FROM analysis_runs WHERE revision_id=$1", [revisionIds[2]]);
  await pool.query("DELETE FROM repository_message_citations WHERE revision_id=$1", [revisionIds[3]]);
  const secondRelease = await releaseUnreferencedRepositoryRevisions(pool, { storedBefore: new Date() });
  if (secondRelease.length !== 4) throw new Error(`Expected four released revisions after reference removal, got ${secondRelease.length}`);

  const claims = await claimRepositoryArtifactsForGc(pool, { leaseOwner: "retention-smoke", limit: 10 });
  if (claims.length !== 5) throw new Error(`Expected five exact GC claims, got ${claims.length}`);
  for (const claim of claims) {
    const collected = await collectClaimedRepositoryArtifact(pool, { remove: async (contentKey) => { removed.push(contentKey); } }, claim);
    if (!collected) throw new Error(`GC claim ${claim.contentKey} was not collected`);
  }
  const terminal = await pool.query<{ artifacts: number; collected: number }>(
    `SELECT
       (SELECT count(*)::int FROM repository_artifacts WHERE content_key=ANY($1::text[])) AS artifacts,
       (SELECT count(*)::int FROM repository_revisions WHERE id=ANY($2::uuid[]) AND state='collected' AND artifact_key IS NULL) AS collected`,
    [artifactKeys, revisionIds],
  );
  if (terminal.rows[0]?.artifacts !== 0 || terminal.rows[0]?.collected !== 5 || removed.length !== 5) throw new Error("Repository retention terminal state did not converge");
  console.info(JSON.stringify({ event: "smoke.repository-retention.completed", protectedReferences: ["active", "dossier", "run", "message_citation"], released: 5, collected: 5 }));
} finally {
  await pool.query("DELETE FROM users WHERE id=$1", [ownerId]).catch(() => undefined);
  await pool.query("DELETE FROM repository_artifacts WHERE content_key=ANY($1::text[])", [artifactKeys]).catch(() => undefined);
  await pool.end();
}
