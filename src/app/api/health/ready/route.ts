import { sql } from "drizzle-orm";

import { getRuntimeConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { apiData, requestId } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = requestId(request);
  const checks = {
    database: "unavailable",
    migration: "missing",
    worker: "stale",
    ai: getRuntimeConfig().deepseek.apiKey ? "configured" : "not_configured",
  };

  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    checks.database = "ready";
    const migration = await db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM schema_migrations`);
    checks.migration = Number(migration.rows[0]?.count ?? 0) > 0 ? "ready" : "missing";
    const heartbeat = await db.execute<{ healthy: boolean }>(
      sql`SELECT EXISTS (SELECT 1 FROM worker_heartbeats WHERE last_seen_at > now() - interval '30 seconds') AS healthy`,
    );
    checks.worker = heartbeat.rows[0]?.healthy ? "ready" : "stale";
  } catch {
    // The structured check values are intentionally safe and contain no connection details.
  }

  const ready = checks.database === "ready" && checks.migration === "ready" && checks.worker === "ready";
  return apiData({ status: ready ? "ready" : "not_ready", checks }, id, { status: ready ? 200 : 503 });
}
