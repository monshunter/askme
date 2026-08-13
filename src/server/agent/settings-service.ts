import "server-only";

import { getPool } from "@/server/db/client";
import { requestOwnerPublicAnalysisCancellation } from "@/server/code-agent/analysis-cancellation";
import { allowedVisibilities } from "@/server/privacy/visibility-policy";

import type { AgentSettingsPatch } from "./agent-settings-input";
import { buildSuggestedQuestions, type SuggestionKnowledgeItem } from "./suggested-questions";

export type AgentSettings = {
  answerTone: "professional" | "concise" | "conversational";
  publicMode: boolean;
  privacySafeMode: boolean;
  suggestedQuestions: string[];
  updatedAt: Date;
};

async function suggestionKnowledge(ownerId: string) {
  const result = await getPool().query<SuggestionKnowledgeItem>(
    `SELECT knowledge.type,knowledge.title
     FROM knowledge_items knowledge
     WHERE knowledge.owner_id=$1 AND knowledge.status='active' AND EXISTS (
       SELECT 1 FROM knowledge_evidence evidence
       JOIN chunks chunk ON chunk.id=evidence.chunk_id AND chunk.owner_id=evidence.owner_id
       JOIN materials material ON material.id=chunk.material_id AND material.owner_id=chunk.owner_id
       WHERE evidence.knowledge_item_id=knowledge.id AND evidence.owner_id=knowledge.owner_id
         AND material.status='indexed' AND material.visibility=ANY($2::visibility[])
     )
     ORDER BY knowledge.updated_at DESC,knowledge.id DESC
     LIMIT 12`,
    [ownerId, allowedVisibilities("candidate_preview")],
  );
  return result.rows;
}

async function selectSettings(ownerId: string) {
  const result = await getPool().query<AgentSettings>(
    `SELECT answer_tone AS "answerTone",public_mode AS "publicMode",privacy_safe_mode AS "privacySafeMode",
            suggested_questions AS "suggestedQuestions",updated_at AS "updatedAt"
     FROM agent_settings WHERE owner_id=$1`,
    [ownerId],
  );
  return result.rows[0] ?? null;
}

export async function loadAgentSettings(ownerId: string) {
  const existing = await selectSettings(ownerId);
  if (existing) return existing;
  const suggestedQuestions = buildSuggestedQuestions(await suggestionKnowledge(ownerId), []);
  await getPool().query(
    `INSERT INTO agent_settings(owner_id,suggested_questions) VALUES ($1,$2::jsonb)
     ON CONFLICT (owner_id) DO NOTHING`,
    [ownerId, JSON.stringify(suggestedQuestions)],
  );
  return (await selectSettings(ownerId))!;
}

export async function updateAgentSettings(ownerId: string, patch: AgentSettingsPatch, requestId?: string) {
  await loadAgentSettings(ownerId);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query<AgentSettings>(
      `UPDATE agent_settings SET
         answer_tone=coalesce($2,answer_tone),
         public_mode=coalesce($3,public_mode),
         privacy_safe_mode=coalesce($4,privacy_safe_mode),
         updated_at=now()
       WHERE owner_id=$1
       RETURNING answer_tone AS "answerTone",public_mode AS "publicMode",privacy_safe_mode AS "privacySafeMode",
                 suggested_questions AS "suggestedQuestions",updated_at AS "updatedAt"`,
      [ownerId, patch.answerTone ?? null, patch.publicMode ?? null, patch.privacySafeMode ?? null],
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

export async function refreshSuggestedQuestions(ownerId: string, requestId?: string) {
  const current = await loadAgentSettings(ownerId);
  const suggestedQuestions = buildSuggestedQuestions(await suggestionKnowledge(ownerId), current.suggestedQuestions);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query<AgentSettings>(
      `UPDATE agent_settings SET suggested_questions=$2::jsonb,updated_at=now() WHERE owner_id=$1
       RETURNING answer_tone AS "answerTone",public_mode AS "publicMode",privacy_safe_mode AS "privacySafeMode",
                 suggested_questions AS "suggestedQuestions",updated_at AS "updatedAt"`,
      [ownerId, JSON.stringify(suggestedQuestions)],
    );
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','agent.suggestions.refresh','agent_settings',$2,'updated',$3,$4::jsonb)`,
      [ownerId, ownerId, requestId ?? null, JSON.stringify({ count: suggestedQuestions.length })],
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
