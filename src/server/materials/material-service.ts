import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";

import { and, asc, count, desc, eq, ilike, inArray, notExists, or, type SQL } from "drizzle-orm";

import { getRuntimeConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { auditEvents, ingestionJobs, knowledgeItems, knowledgeSources, materials } from "@/server/db/schema";
import { AppError } from "@/server/errors";

import { resolveStoredMaterialDirectory } from "./file-validation";
import type { MaterialListQuery } from "./material-query";

const materialSelection = {
  id: materials.id,
  title: materials.title,
  originalName: materials.originalName,
  kind: materials.kind,
  mimeType: materials.mimeType,
  sizeBytes: materials.sizeBytes,
  externalUrl: materials.externalUrl,
  sourceMeta: materials.sourceMeta,
  status: materials.status,
  visibility: materials.visibility,
  summary: materials.summary,
  errorCode: materials.errorCode,
  errorMessage: materials.errorMessage,
  createdAt: materials.createdAt,
  updatedAt: materials.updatedAt,
  indexedAt: materials.indexedAt,
};

export async function listMaterials(ownerId: string, query: MaterialListQuery) {
  const filters: SQL[] = [eq(materials.ownerId, ownerId)];
  if (query.status) filters.push(eq(materials.status, query.status));
  if (query.kind) filters.push(eq(materials.kind, query.kind));
  if (query.search) {
    const pattern = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
    const search = or(ilike(materials.title, pattern), ilike(materials.originalName, pattern), ilike(materials.externalUrl, pattern));
    if (search) filters.push(search);
  }
  const where = and(...filters);
  const db = getDb();
  const [items, totals] = await Promise.all([
    db
      .select(materialSelection)
      .from(materials)
      .where(where)
      .orderBy(query.sort === "newest" ? desc(materials.createdAt) : asc(materials.createdAt), desc(materials.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(materials).where(where),
  ]);
  const total = totals[0]?.total ?? 0;
  return { items, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
}

export async function retryMaterial(ownerId: string, materialId: string, requestId?: string) {
  return getDb().transaction(async (transaction) => {
    const [material] = await transaction
      .update(materials)
      .set({
        status: "queued",
        errorCode: null,
        errorMessage: null,
        indexedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(materials.id, materialId), eq(materials.ownerId, ownerId), eq(materials.status, "failed")))
      .returning({ id: materials.id, title: materials.title, status: materials.status, updatedAt: materials.updatedAt });
    if (!material) {
      const [existing] = await transaction
        .select({ status: materials.status })
        .from(materials)
        .where(and(eq(materials.id, materialId), eq(materials.ownerId, ownerId)))
        .limit(1);
      if (!existing) throw new AppError("MATERIAL_NOT_FOUND", "The material was not found.", 404);
      throw new AppError("MATERIAL_NOT_RETRYABLE", "Only failed materials can be retried.", 409, { status: existing.status });
    }

    await transaction
      .insert(ingestionJobs)
      .values({ materialId, ownerId })
      .onConflictDoUpdate({
        target: ingestionJobs.materialId,
        set: {
          ownerId,
          status: "queued",
          attempts: 0,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextRunAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
          completedAt: null,
          updatedAt: new Date(),
        },
      });
    await transaction.insert(auditEvents).values({
      actorId: ownerId,
      actorRole: "candidate",
      action: "material.retry",
      targetType: "material",
      targetId: materialId,
      outcome: "queued",
      requestId,
    });
    return material;
  });
}

export async function deleteMaterial(ownerId: string, materialId: string, requestId?: string) {
  const db = getDb();
  const [record] = await db
    .select({ id: materials.id, storagePath: materials.storagePath })
    .from(materials)
    .where(and(eq(materials.id, materialId), eq(materials.ownerId, ownerId)))
    .limit(1);
  if (!record) throw new AppError("MATERIAL_NOT_FOUND", "The material was not found.", 404);

  const materialDirectory = record.storagePath
    ? resolveStoredMaterialDirectory(getRuntimeConfig().uploadRoot, ownerId, materialId, record.storagePath)
    : null;
  const quarantinedDirectory = materialDirectory ? `${materialDirectory}.deleting-${randomUUID()}` : null;
  if (materialDirectory && quarantinedDirectory) {
    try {
      await rename(materialDirectory, quarantinedDirectory);
    } catch {
      throw new AppError("MATERIAL_FILE_UNAVAILABLE", "The material file could not be isolated for deletion.", 500);
    }
  }

  try {
    await db.transaction(async (transaction) => {
      const affectedKnowledge = await transaction
        .select({ id: knowledgeSources.knowledgeItemId })
        .from(knowledgeSources)
        .where(and(eq(knowledgeSources.materialId, materialId), eq(knowledgeSources.ownerId, ownerId)));
      const deleted = await transaction
        .delete(materials)
        .where(and(eq(materials.id, materialId), eq(materials.ownerId, ownerId)))
        .returning({ id: materials.id });
      if (!deleted[0]) throw new AppError("MATERIAL_NOT_FOUND", "The material was not found.", 404);
      if (affectedKnowledge.length > 0) {
        const remainingSource = transaction
          .select({ id: knowledgeSources.knowledgeItemId })
          .from(knowledgeSources)
          .where(and(eq(knowledgeSources.knowledgeItemId, knowledgeItems.id), eq(knowledgeSources.ownerId, ownerId)));
        await transaction
          .delete(knowledgeItems)
          .where(
            and(
              eq(knowledgeItems.ownerId, ownerId),
              inArray(knowledgeItems.id, affectedKnowledge.map((item) => item.id)),
              notExists(remainingSource),
            ),
          );
      }
      await transaction.insert(auditEvents).values({
        actorId: ownerId,
        actorRole: "candidate",
        action: "material.delete",
        targetType: "material",
        targetId: materialId,
        outcome: "deleted",
        requestId,
      });
    });
  } catch (error) {
    if (materialDirectory && quarantinedDirectory) {
      try {
        await rename(quarantinedDirectory, materialDirectory);
      } catch {
        throw new AppError("MATERIAL_DELETE_ROLLBACK_FAILED", "The material deletion failed and its file could not be restored.", 500);
      }
    }
    throw error;
  }

  if (quarantinedDirectory) {
    try {
      await rm(quarantinedDirectory, { recursive: true });
    } catch {
      throw new AppError("MATERIAL_FILE_CLEANUP_FAILED", "The material record was deleted but its quarantined file still requires cleanup.", 500);
    }
  }
  return { id: materialId };
}
