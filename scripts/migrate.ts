import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrationRoot = path.resolve(process.cwd(), "migrations");
    const files = (await readdir(migrationRoot)).filter((file) => file.endsWith(".sql")).sort();

    for (const file of files) {
      const applied = await client.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS exists",
        [file],
      );
      if (applied.rows[0]?.exists) continue;

      const sql = await readFile(path.join(migrationRoot, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.info(JSON.stringify({ event: "migration.applied", version: file }));
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown migration error";
  console.error(JSON.stringify({ event: "migration.failed", message }));
  process.exitCode = 1;
});
