import type { Pool } from "pg";

export async function maintainEphemeralPublicState(pool: Pick<Pool, "query">) {
  const conversations = await pool.query("DELETE FROM conversations WHERE mode='public' AND expires_at<=now()");
  const rateLimits = await pool.query("DELETE FROM public_rate_limits WHERE updated_at<now()-interval '2 days'");
  return { conversations: conversations.rowCount ?? 0, rateLimits: rateLimits.rowCount ?? 0 };
}
