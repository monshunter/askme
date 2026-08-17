import "server-only";

import { getPool } from "@/server/db/client";
import { requestOwnerPublicAnalysisCancellation } from "@/server/code-agent/analysis-cancellation";
import { AppError } from "@/server/errors";

import type { AgentSettingsPatch } from "./agent-settings-input";

export type AgentSettings = {
  answerTone: "professional" | "concise" | "conversational";
  publicMode: boolean;
  privacySafeMode: boolean;
  profileMaterialId: string | null;
  updatedAt: Date;
};

async function selectSettings(ownerId: string) {
  const result = await getPool().query<AgentSettings>(
    `SELECT answer_tone AS "answerTone",public_mode AS "publicMode",privacy_safe_mode AS "privacySafeMode",profile_material_id AS "profileMaterialId",updated_at AS "updatedAt"
     FROM agent_settings WHERE owner_id=$1`,
    [ownerId],
  );
  return result.rows[0] ?? null;
}

export async function loadAgentSettings(ownerId: string) {
  const existing = await selectSettings(ownerId);
  if (existing) return existing;
  await getPool().query(
    `INSERT INTO agent_settings(owner_id) VALUES ($1) ON CONFLICT (owner_id) DO NOTHING`,
    [ownerId],
  );
  return (await selectSettings(ownerId))!;
}

export async function updateAgentSettings(ownerId: string, patch: AgentSettingsPatch, requestId?: string) {
  await loadAgentSettings(ownerId);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (patch.profileMaterialId) {
      const eligible = await client.query(
        `SELECT 1 FROM materials
         WHERE id=$1 AND owner_id=$2 AND kind='file' AND status='indexed' AND visibility='public_preview' AND storage_path IS NOT NULL`,
        [patch.profileMaterialId, ownerId],
      );
      if (!eligible.rows[0]) {
        throw new AppError("MATERIAL_NOT_ELIGIBLE", "This material cannot be used as the public profile document.", 400);
      }
    }
    const updated = await client.query<AgentSettings>(
      `UPDATE agent_settings SET
         answer_tone=coalesce($2,answer_tone),
         public_mode=coalesce($3,public_mode),
         privacy_safe_mode=coalesce($4,privacy_safe_mode),
         profile_material_id=CASE WHEN $6::boolean THEN $5::uuid ELSE profile_material_id END,
         updated_at=now()
       WHERE owner_id=$1
       RETURNING answer_tone AS "answerTone",public_mode AS "publicMode",privacy_safe_mode AS "privacySafeMode",profile_material_id AS "profileMaterialId",updated_at AS "updatedAt"`,
      [ownerId, patch.answerTone ?? null, patch.publicMode ?? null, patch.privacySafeMode ?? null, patch.profileMaterialId ?? null, patch.profileMaterialId !== undefined],
    );
    if (patch.publicMode === false) await requestOwnerPublicAnalysisCancellation(client, ownerId, "public_mode_disabled");
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','agent.settings.update','agent_settings',$2,'updated',$3,$4::jsonb)`,
      [ownerId, ownerId, requestId ?? null, JSON.stringify({ changedFields: Object.keys(patch).sort() })],
    );
    await client.query("COMMIT");
    return updated.rows[0]!;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
