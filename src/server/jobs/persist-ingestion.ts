import type { Pool } from "pg";

import { AppError } from "@/server/errors";
import type { EvidenceChunk } from "@/server/knowledge/chunking";
import type { KnowledgeOrganization } from "@/server/knowledge/organizer";
import { enqueueMaterialSourceForOpenIndexes } from "@/server/rag/index-coordinator";

import type { IngestionLease } from "./ingestion-jobs";

export async function persistIngestionResult(
  pool: Pool,
  lease: IngestionLease,
  chunks: EvidenceChunk[],
  organization: KnowledgeOrganization,
  usage: { inputTokens: number | null; outputTokens: number | null },
  model: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ownedLease = await client.query(
      `SELECT id FROM ingestion_jobs
       WHERE id=$1 AND material_id=$2 AND owner_id=$3 AND status='processing'
         AND lease_owner=$4 AND lease_expires_at > now()
       FOR UPDATE`,
      [lease.jobId, lease.material.id, lease.material.ownerId, lease.leaseOwner],
    );
    if (!ownedLease.rows[0]) throw new AppError("JOB_LEASE_LOST", "The ingestion job lease is no longer owned by this worker.", 409);

    const previous = await client.query<{ knowledgeItemId: string }>(
      `SELECT knowledge_item_id AS "knowledgeItemId"
       FROM knowledge_sources WHERE material_id=$1 AND owner_id=$2`,
      [lease.material.id, lease.material.ownerId],
    );
    const featuredPrevious = await client.query<{ type: string; title: string; featuredAt: Date }>(
      `SELECT type,title,featured_at AS "featuredAt"
       FROM knowledge_items WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND featured_at IS NOT NULL`,
      [previous.rows.map((item) => item.knowledgeItemId), lease.material.ownerId],
    );
    const carriedFeatured = new Map(featuredPrevious.rows.map((item) => [`${item.type}::${item.title}`, item.featuredAt]));
    await client.query("DELETE FROM knowledge_sources WHERE material_id=$1 AND owner_id=$2", [lease.material.id, lease.material.ownerId]);
    for (const item of previous.rows) {
      await client.query(
        `DELETE FROM knowledge_items ki
         WHERE ki.id=$1 AND ki.owner_id=$2
           AND NOT EXISTS (SELECT 1 FROM knowledge_sources ks WHERE ks.knowledge_item_id=ki.id)`,
        [item.knowledgeItemId, lease.material.ownerId],
      );
    }

    await client.query("DELETE FROM chunks WHERE material_id=$1 AND owner_id=$2", [lease.material.id, lease.material.ownerId]);
    const storedChunks = await client.query<{ id: string; position: number }>(
      `INSERT INTO chunks(material_id,owner_id,position,content,token_estimate)
       SELECT $1,$2,entry.position,entry.content,entry.token_estimate
       FROM unnest($3::integer[],$4::text[],$5::integer[]) AS entry(position,content,token_estimate)
       RETURNING id,position`,
      [
        lease.material.id,
        lease.material.ownerId,
        chunks.map((chunk) => chunk.position),
        chunks.map((chunk) => chunk.content),
        chunks.map((chunk) => chunk.tokenEstimate),
      ],
    );

    const knowledgeItemIds: string[] = [];
    for (const item of organization.items) {
      const created = await client.query<{ id: string }>(
        `INSERT INTO knowledge_items(owner_id,type,title,summary,highlights,entities,confidence)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) RETURNING id`,
        [lease.material.ownerId, item.type, item.title, item.summary, JSON.stringify(item.highlights), JSON.stringify(item.entities), item.confidence],
      );
      const knowledgeItemId = created.rows[0]?.id;
      if (!knowledgeItemId) throw new AppError("KNOWLEDGE_WRITE_FAILED", "The organized knowledge could not be stored.", 500);
      knowledgeItemIds.push(knowledgeItemId);
      const carriedKey = `${item.type}::${item.title}`;
      const carriedAt = carriedFeatured.get(carriedKey);
      if (carriedAt) {
        await client.query("UPDATE knowledge_items SET featured_at=$3 WHERE id=$1 AND owner_id=$2", [knowledgeItemId, lease.material.ownerId, carriedAt]);
        carriedFeatured.delete(carriedKey);
      }
      await client.query("INSERT INTO knowledge_sources(knowledge_item_id,material_id,owner_id) VALUES ($1,$2,$3)", [
        knowledgeItemId,
        lease.material.id,
        lease.material.ownerId,
      ]);
      const chunkIds = item.evidencePositions.map((position) => storedChunks.rows.find((chunk) => chunk.position === position)?.id);
      if (chunkIds.some((chunkId) => !chunkId)) {
        throw new AppError("AI_ORGANIZATION_INVALID", "The AI provider referenced evidence that was not supplied.", 502);
      }
      await client.query(
        `INSERT INTO knowledge_evidence(knowledge_item_id,chunk_id,owner_id)
         SELECT $1,entry.chunk_id,$2 FROM unnest($3::uuid[]) AS entry(chunk_id)`,
        [knowledgeItemId, lease.material.ownerId, chunkIds],
      );
    }

    await client.query(
      `UPDATE materials
       SET status='indexed',summary=$3,error_code=NULL,error_message=NULL,indexed_at=now(),processing_version=processing_version+1,updated_at=now()
       WHERE id=$1 AND owner_id=$2`,
      [lease.material.id, lease.material.ownerId, organization.materialSummary],
    );
    await enqueueMaterialSourceForOpenIndexes(client, lease.material.id, lease.material.ownerId);
    await client.query(
      `UPDATE ingestion_jobs
       SET status='completed',lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,last_error_message=NULL,completed_at=now(),updated_at=now()
       WHERE id=$1`,
      [lease.jobId],
    );
    await client.query(
      `INSERT INTO ai_usage(owner_id,purpose,model,input_tokens,output_tokens,outcome)
       VALUES ($1,'material.organize',$2,$3,$4,'success')`,
      [lease.material.ownerId, model, usage.inputTokens, usage.outputTokens],
    );
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,metadata)
       VALUES ($1,'system','material.index','material',$2,'indexed',$3::jsonb)`,
      [lease.material.ownerId, lease.material.id, JSON.stringify({ jobId: lease.jobId, chunkCount: chunks.length, knowledgeItemCount: knowledgeItemIds.length, attempt: lease.attempt })],
    );
    await client.query("COMMIT");
    return { materialId: lease.material.id, chunkCount: chunks.length, knowledgeItemIds };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
