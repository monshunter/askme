import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";

import { getRuntimeConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { auditEvents, ingestionJobs, materials } from "@/server/db/schema";
import { AppError, toAppError } from "@/server/errors";

import { buildStorageLocation } from "./file-validation";
import { createExternalSnapshot, type ExternalSourceInput } from "./external-sources";

export async function createConnectedMaterial(ownerId: string, input: ExternalSourceInput, requestId?: string) {
  const snapshot = await createExternalSnapshot(input);
  const materialId = randomUUID();
  const location = buildStorageLocation(getRuntimeConfig().uploadRoot, ownerId, materialId, "txt");
  const bytes = Buffer.from(snapshot.content, "utf8");
  const checksum = createHash("sha256").update(bytes).digest("hex");

  await mkdir(location.absoluteDirectory, { recursive: true, mode: 0o700 });
  await writeFile(location.absolutePath, bytes, { flag: "wx", mode: 0o600 });
  try {
    return await getDb().transaction(async (transaction) => {
      const [material] = await transaction
        .insert(materials)
        .values({
          id: materialId,
          ownerId,
          kind: snapshot.kind,
          title: snapshot.title,
          mimeType: "text/plain",
          sizeBytes: bytes.length,
          storagePath: location.relativePath,
          externalUrl: snapshot.externalUrl,
          sourceMeta: snapshot.sourceMeta,
          status: "queued",
          visibility: "private",
          contentChecksum: checksum,
        })
        .returning({
          id: materials.id,
          title: materials.title,
          kind: materials.kind,
          externalUrl: materials.externalUrl,
          sizeBytes: materials.sizeBytes,
          status: materials.status,
          visibility: materials.visibility,
          createdAt: materials.createdAt,
        });
      if (!material) throw new AppError("MATERIAL_CREATE_FAILED", "The connected material could not be created.", 500);

      await transaction.insert(ingestionJobs).values({ materialId, ownerId });
      await transaction.insert(auditEvents).values({
        actorId: ownerId,
        actorRole: "candidate",
        action: "material.connect",
        targetType: "material",
        targetId: materialId,
        outcome: "queued",
        requestId,
        metadata: { kind: snapshot.kind, sizeBytes: bytes.length },
      });
      return material;
    });
  } catch (error) {
    try {
      await rm(location.absoluteDirectory, { recursive: true });
    } catch {
      throw new AppError("MATERIAL_ROLLBACK_FAILED", "The connected material could not be created or safely rolled back.", 500);
    }
    throw error;
  }
}

export async function recordConnectionFailure(ownerId: string, kind: ExternalSourceInput["kind"], error: unknown, requestId?: string) {
  const safeError = toAppError(error);
  await getDb().insert(auditEvents).values({
    actorId: ownerId,
    actorRole: "candidate",
    action: "material.connect",
    targetType: "material",
    outcome: "failed",
    requestId,
    metadata: { kind, errorCode: safeError.code },
  });
}
