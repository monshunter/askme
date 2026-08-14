import "server-only";

import { createHash } from "node:crypto";

import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";

export function authRateScope(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function consumeAuthRateLimit(scope: string, limit: number, windowSeconds: number) {
  const result = await getPool().query<{ requestCount: number; windowStartedAt: Date }>(
    `INSERT INTO auth_rate_limits(scope_key,window_started_at,request_count)
     VALUES ($1,now(),1)
     ON CONFLICT (scope_key) DO UPDATE SET
       window_started_at=CASE WHEN auth_rate_limits.window_started_at <= now()-($2::int*interval '1 second') THEN now() ELSE auth_rate_limits.window_started_at END,
       request_count=CASE WHEN auth_rate_limits.window_started_at <= now()-($2::int*interval '1 second') THEN 1 ELSE auth_rate_limits.request_count+1 END,
       updated_at=now()
     RETURNING request_count AS "requestCount",window_started_at AS "windowStartedAt"`,
    [authRateScope(scope), windowSeconds],
  );
  const row = result.rows[0]!;
  if (row.requestCount > limit) {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - row.windowStartedAt.getTime()) / 1_000));
    throw new AppError("AUTH_RATE_LIMITED", "Too many authentication attempts. Wait before trying again.", 429, {
      retryAfterSeconds: Math.max(1, windowSeconds - elapsedSeconds),
    });
  }
  return { remaining: Math.max(0, limit - row.requestCount) };
}
