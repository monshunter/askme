import "server-only";

import type { Pool, PoolClient } from "pg";

import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";
import type { MaterialListQuery } from "@/server/materials/material-query";
import { listMaterials } from "@/server/materials/material-service";

import type { MaterialVisibility } from "./visibility-policy";
import { derivePrivacyConfirmation, type StoredPrivacyConfirmation } from "./privacy-state";

type PolicyRow = {
  currentRevision: number;
  confirmationRevision: number | null;
  confirmedAt: Date | null;
};

async function policyRow(ownerId: string, client: Pool | PoolClient = getPool()) {
  const result = await client.query<PolicyRow>(
    `SELECT coalesce(state.revision,1)::int AS "currentRevision",
            confirmation.policy_revision::int AS "confirmationRevision",confirmation.confirmed_at AS "confirmedAt"
     FROM (SELECT $1::uuid AS owner_id) requested
     LEFT JOIN privacy_policy_states state ON state.owner_id=requested.owner_id
     LEFT JOIN privacy_confirmations confirmation ON confirmation.owner_id=requested.owner_id`,
    [ownerId],
  );
  return result.rows[0] ?? { currentRevision: 1, confirmationRevision: null, confirmedAt: null };
}

function confirmationFromRow(row: PolicyRow) {
  const stored: StoredPrivacyConfirmation | null = row.confirmationRevision && row.confirmedAt
    ? { policyRevision: row.confirmationRevision, confirmedAt: row.confirmedAt }
    : null;
  return derivePrivacyConfirmation(row.currentRevision, stored);
}

export async function getPrivacyOverview(ownerId: string, query: MaterialListQuery) {
  const pool = getPool();
  const [materials, state, countsResult, samplesResult] = await Promise.all([
    listMaterials(ownerId, query),
    policyRow(ownerId, pool),
    pool.query<{ visibility: MaterialVisibility; count: number }>(
      "SELECT visibility,count(*)::int AS count FROM materials WHERE owner_id=$1 GROUP BY visibility ORDER BY visibility",
      [ownerId],
    ),
    pool.query(
      `SELECT id,title,kind,status,visibility,updated_at AS "updatedAt"
       FROM materials WHERE owner_id=$1
       ORDER BY updated_at DESC,id DESC LIMIT 20`,
      [ownerId],
    ),
  ]);
  const counts = Object.fromEntries(countsResult.rows.map((row) => [row.visibility, row.count])) as Partial<Record<MaterialVisibility, number>>;
  const samples = samplesResult.rows as Array<{ id: string; title: string; kind: string; status: string; visibility: MaterialVisibility; updatedAt: Date }>;
  return {
    materials,
    counts: {
      private: counts.private ?? 0,
      agentOnly: counts.agent_only ?? 0,
      citationAllowed: counts.citation_allowed ?? 0,
      publicPreview: counts.public_preview ?? 0,
      interviewerAccessible: (counts.citation_allowed ?? 0) + (counts.public_preview ?? 0),
      interviewerHidden: (counts.private ?? 0) + (counts.agent_only ?? 0),
    },
    preview: {
      accessible: samples.filter((item) => item.visibility === "citation_allowed" || item.visibility === "public_preview").slice(0, 8),
      hidden: samples.filter((item) => item.visibility === "private" || item.visibility === "agent_only").slice(0, 8),
    },
    confirmation: confirmationFromRow(state),
  };
}

async function lockPolicyState(client: PoolClient, ownerId: string) {
  const result = await client.query<{ revision: number }>(
    `INSERT INTO privacy_policy_states(owner_id,revision,updated_at) VALUES ($1,1,now())
     ON CONFLICT (owner_id) DO UPDATE SET updated_at=privacy_policy_states.updated_at
     RETURNING revision`,
    [ownerId],
  );
  return result.rows[0]?.revision ?? 1;
}

export async function updateMaterialVisibility(ownerId: string, materialId: string, visibility: MaterialVisibility, requestId?: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<{ id: string; title: string; visibility: MaterialVisibility }>(
      "SELECT id,title,visibility FROM materials WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      [materialId, ownerId],
    );
    const material = selected.rows[0];
    if (!material) throw new AppError("MATERIAL_NOT_FOUND", "The material was not found.", 404);
    if (material.visibility === visibility) {
      await lockPolicyState(client, ownerId);
      const state = await policyRow(ownerId, client);
      await client.query("COMMIT");
      return { material, confirmation: confirmationFromRow(state), changed: false };
    }

    const updated = await client.query<{ id: string; title: string; visibility: MaterialVisibility; updatedAt: Date }>(
      "UPDATE materials SET visibility=$3,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING id,title,visibility,updated_at AS \"updatedAt\"",
      [materialId, ownerId, visibility],
    );
    const revisionResult = await client.query<{ revision: number }>(
      `INSERT INTO privacy_policy_states(owner_id,revision,updated_at) VALUES ($1,2,now())
       ON CONFLICT (owner_id) DO UPDATE SET revision=privacy_policy_states.revision+1,updated_at=now()
       RETURNING revision`,
      [ownerId],
    );
    const revision = revisionResult.rows[0]?.revision ?? 2;
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','material.visibility','material',$2,'updated',$3,$4::jsonb)`,
      [ownerId, materialId, requestId ?? null, JSON.stringify({ from: material.visibility, to: visibility, policyRevision: revision })],
    );
    const state = await policyRow(ownerId, client);
    await client.query("COMMIT");
    return { material: updated.rows[0], confirmation: confirmationFromRow(state), changed: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function confirmPrivacyPolicy(ownerId: string, requestId?: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const revision = await lockPolicyState(client, ownerId);
    const confirmed = await client.query<{ policyRevision: number; confirmedAt: Date }>(
      `INSERT INTO privacy_confirmations(owner_id,policy_revision,confirmed_at) VALUES ($1,$2,now())
       ON CONFLICT (owner_id) DO UPDATE SET policy_revision=excluded.policy_revision,confirmed_at=excluded.confirmed_at
       RETURNING policy_revision AS "policyRevision",confirmed_at AS "confirmedAt"`,
      [ownerId, revision],
    );
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','privacy.confirm','privacy_policy',$2,'confirmed',$3,$4::jsonb)`,
      [ownerId, ownerId, requestId ?? null, JSON.stringify({ policyRevision: revision })],
    );
    await client.query("COMMIT");
    return { confirmed: true, ...(confirmed.rows[0] ?? { policyRevision: revision, confirmedAt: new Date() }) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
