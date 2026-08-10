import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";

import { getRuntimeConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { auditEvents, ingestionJobs, materials } from "@/server/db/schema";
import { AppError } from "@/server/errors";

import { buildStorageLocation, safeOriginalName, validateUpload } from "./file-validation";

export type UploadedFileInput = {
  name: string;
  type: string;
  size: number;
  bytes: Buffer;
};

export async function createUploadedMaterial(ownerId: string, file: UploadedFileInput, requestId?: string) {
  const validation = await validateUpload(file);
  const originalName = safeOriginalName(file.name);
  const materialId = randomUUID();
  const location = buildStorageLocation(getRuntimeConfig().uploadRoot, ownerId, materialId, validation.extension);
  const checksum = createHash("sha256").update(file.bytes).digest("hex");

  await mkdir(location.absoluteDirectory, { recursive: true, mode: 0o700 });
  await writeFile(location.absolutePath, file.bytes, { flag: "wx", mode: 0o600 });

  try {
    const db = getDb();
    return await db.transaction(async (transaction) => {
      const [material] = await transaction
        .insert(materials)
        .values({
          id: materialId,
          ownerId,
          kind: "file",
          title: originalName,
          originalName,
          mimeType: validation.mimeType,
          sizeBytes: file.size,
          storagePath: location.relativePath,
          sourceMeta: { extension: validation.extension },
          status: "queued",
          visibility: "private",
          contentChecksum: checksum,
        })
        .returning({
          id: materials.id,
          title: materials.title,
          kind: materials.kind,
          mimeType: materials.mimeType,
          sizeBytes: materials.sizeBytes,
          status: materials.status,
          visibility: materials.visibility,
          createdAt: materials.createdAt,
        });
      if (!material) throw new AppError("MATERIAL_CREATE_FAILED", "The material could not be created.", 500);

      await transaction.insert(ingestionJobs).values({ materialId, ownerId });
      await transaction.insert(auditEvents).values({
        actorId: ownerId,
        actorRole: "candidate",
        action: "material.upload",
        targetType: "material",
        targetId: materialId,
        outcome: "queued",
        requestId,
        metadata: { mimeType: validation.mimeType, sizeBytes: file.size },
      });
      return material;
    });
  } catch (error) {
    try {
      await rm(location.absoluteDirectory, { recursive: true });
    } catch {
      throw new AppError("MATERIAL_ROLLBACK_FAILED", "The material could not be created or safely rolled back.", 500);
    }
    throw error;
  }
}
