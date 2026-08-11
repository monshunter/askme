import "server-only";

import type { PoolClient } from "pg";

import { getRuntimeConfig } from "@/server/config";
import { getPool } from "@/server/db/client";

import type { SettingsInput } from "./admin-input";
import { policyEntries, resolvePlatformPolicies } from "./platform-policy";

const PLATFORM_POLICY_KEYS = [
  "public_session_hourly_limit",
  "public_chat_minute_limit",
  "public_chat_daily_limit",
  "negative_feedback_auto_flag",
] as const;
const CURRENT_MIGRATION = "0011_admin_governance.sql";

type Queryable = Pick<PoolClient, "query">;

export async function loadPlatformPolicies(queryable: Queryable = getPool()) {
  const result = await queryable.query<{ key: string; value: unknown }>(
    "SELECT key,value FROM platform_settings WHERE key=ANY($1::text[])",
    [PLATFORM_POLICY_KEYS],
  );
  return resolvePlatformPolicies(result.rows);
}

export async function loadAdminSettings() {
  const config = getRuntimeConfig();
  const [policies, migrationResult, workerResult, aiUsageResult] = await Promise.all([
    loadPlatformPolicies(),
    getPool().query<{ migrationCount: number; currentApplied: boolean }>(
      `SELECT count(*)::int AS "migrationCount",bool_or(version=$1) AS "currentApplied" FROM schema_migrations`,
      [CURRENT_MIGRATION],
    ),
    getPool().query<{ workerId: string; version: string; lastSeenAt: Date; fresh: boolean }>(
      `SELECT worker_id AS "workerId",version,last_seen_at AS "lastSeenAt",last_seen_at>now()-interval '30 seconds' AS fresh
       FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 1`,
    ),
    getPool().query<{ outcome: string; errorCode: string | null; createdAt: Date }>(
      `SELECT outcome,error_code AS "errorCode",created_at AS "createdAt"
       FROM ai_usage ORDER BY created_at DESC,id DESC LIMIT 1`,
    ),
  ]);
  const migration = migrationResult.rows[0];
  const worker = workerResult.rows[0];
  const lastAiUsage = aiUsageResult.rows[0] ?? null;
  let aiBaseUrl = config.deepseek.baseUrl;
  try { aiBaseUrl = new URL(config.deepseek.baseUrl).origin; } catch { /* Config validation is represented by the configured status. */ }
  return {
    health: {
      database: { status: "ready" as const },
      migration: { status: migration?.currentApplied ? "ready" as const : "outdated" as const, count: migration?.migrationCount ?? 0, expected: CURRENT_MIGRATION },
      worker: worker ? { status: worker.fresh ? "ready" as const : "stale" as const, workerId: worker.workerId, version: worker.version, lastSeenAt: worker.lastSeenAt } : { status: "missing" as const, workerId: null, version: null, lastSeenAt: null },
      ai: { status: config.deepseek.apiKey ? "configured" as const : "not_configured" as const, model: config.deepseek.model, baseUrl: aiBaseUrl, lastUsage: lastAiUsage },
      mail: { status: config.mail.status, host: config.mail.host, port: config.mail.port, secure: config.mail.secure, from: config.mail.from },
    },
    policies,
  };
}

export async function updatePlatformSettings(actorId: string, input: SettingsInput, requestId?: string) {
  const entries = policyEntries(input);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const entry of entries) {
      await client.query(
        `INSERT INTO platform_settings(key,value,updated_by,updated_at) VALUES ($1,$2::jsonb,$3,now())
         ON CONFLICT (key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,
        [entry.key, JSON.stringify(entry.value), actorId],
      );
    }
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,outcome,request_id,metadata)
       VALUES ($1,'admin','admin.settings.update','platform_settings','updated',$2,$3::jsonb)`,
      [actorId, requestId ?? null, JSON.stringify({ keys: entries.map((entry) => entry.key) })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return loadAdminSettings();
}
