import "server-only";

import { readFile } from "node:fs/promises";

import { getRuntimeConfig } from "@/server/config";
import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { allowedVisibilities } from "@/server/privacy/visibility-policy";
import { requirePublicAgentContext } from "@/server/publication/public-agent-service";

import { resolveStoredMaterialPath, safeOriginalName } from "./file-validation";

export type StoredMaterialContent = {
  id: string;
  ownerId: string;
  title: string;
  originalName: string | null;
  mimeType: string | null;
  storagePath: string;
};

export async function getCandidateMaterialContent(ownerId: string, materialId: string) {
  const result = await getPool().query<StoredMaterialContent>(
    `SELECT id,owner_id AS "ownerId",title,original_name AS "originalName",mime_type AS "mimeType",storage_path AS "storagePath"
     FROM materials
     WHERE id=$1 AND owner_id=$2 AND kind='file' AND storage_path IS NOT NULL`,
    [materialId, ownerId],
  );
  const material = result.rows[0];
  if (!material) throw new AppError("MATERIAL_NOT_FOUND", "The material was not found.", 404);
  return readStoredMaterialContent(material);
}

export async function getPublicMaterialContent(slug: string, materialId: string) {
  const context = await requirePublicAgentContext(slug);
  const result = await getPool().query<StoredMaterialContent>(
    `SELECT id,owner_id AS "ownerId",title,original_name AS "originalName",mime_type AS "mimeType",storage_path AS "storagePath"
     FROM materials
     WHERE id=$1 AND owner_id=$2 AND kind='file' AND status='indexed'
       AND visibility=ANY($3::visibility[]) AND storage_path IS NOT NULL`,
    [materialId, context.ownerId, allowedVisibilities("public_file")],
  );
  const material = result.rows[0];
  if (!material) throw new AppError("PUBLIC_SOURCE_NOT_FOUND", "The public source was not found.", 404);
  return readStoredMaterialContent(material);
}

export async function readStoredMaterialContent(material: StoredMaterialContent) {
  const absolutePath = resolveStoredMaterialPath(getRuntimeConfig().uploadRoot, material.ownerId, material.id, material.storagePath);
  try {
    return { material, bytes: await readFile(absolutePath) };
  } catch {
    throw new AppError("MATERIAL_FILE_UNAVAILABLE", "The material file is unavailable.", 404);
  }
}

function encodedFileName(name: string) {
  return encodeURIComponent(name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function materialContentResponse(content: Awaited<ReturnType<typeof readStoredMaterialContent>>, cacheControl = "private, no-store") {
  const name = safeOriginalName(content.material.originalName ?? content.material.title);
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(content.bytes), {
    headers: {
      "Cache-Control": cacheControl,
      "Content-Disposition": `inline; filename="${fallback}"; filename*=UTF-8''${encodedFileName(name)}`,
      "Content-Length": String(content.bytes.byteLength),
      "Content-Type": content.material.mimeType ?? "application/octet-stream",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}
