import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { requireDatabaseUrl } from "@/server/config";

import * as schema from "./schema";

const globalForDb = globalThis as unknown as { askmePool?: Pool; askmeDb?: ReturnType<typeof drizzle<typeof schema>> };

function createPool() {
  return new Pool({ connectionString: requireDatabaseUrl(), max: 10 });
}

export function getPool() {
  if (!globalForDb.askmePool) globalForDb.askmePool = createPool();
  return globalForDb.askmePool;
}

export function getDb() {
  if (!globalForDb.askmeDb) globalForDb.askmeDb = drizzle(getPool(), { schema });
  return globalForDb.askmeDb;
}
