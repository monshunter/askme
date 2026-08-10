import { Client } from "pg";

import { getRuntimeConfig, requireDatabaseUrl } from "../src/server/config";
import { hashPassword } from "../src/server/auth/crypto";

type Role = "candidate" | "admin";

async function ensureUser(client: Client, role: Role, email: string | null, password: string | null) {
  if (!email || !password) throw new Error(`ASKME_${role.toUpperCase()}_EMAIL and ASKME_${role.toUpperCase()}_PASSWORD are required`);
  if (password.length < 12) throw new Error(`${role} bootstrap password must be at least 12 characters`);

  const existing = await client.query<{ id: string; role: Role }>("SELECT id, role FROM users WHERE email = $1", [email.toLowerCase()]);
  if (existing.rows[0]) {
    if (existing.rows[0].role !== role) throw new Error(`Bootstrap account ${email} already exists with a different role`);
    return { id: existing.rows[0].id, created: false };
  }

  const passwordHash = await hashPassword(password);
  const displayName = role === "admin" ? "Platform Admin" : "Local Candidate";
  const created = await client.query<{ id: string }>(
    `INSERT INTO users(email, password_hash, role, display_name, headline, location, bio)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      email.toLowerCase(),
      passwordHash,
      role,
      displayName,
      role === "candidate" ? "Career professional" : null,
      role === "candidate" ? "Local environment" : null,
      role === "candidate" ? "This profile is owned and editable by the local Candidate account." : null,
    ],
  );
  return { id: created.rows[0]!.id, created: true };
}

async function main() {
  const config = getRuntimeConfig();
  const client = new Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  try {
    const candidate = await ensureUser(client, "candidate", config.bootstrap.candidateEmail, config.bootstrap.candidatePassword);
    const admin = await ensureUser(client, "admin", config.bootstrap.adminEmail, config.bootstrap.adminPassword);
    await client.query(
      `INSERT INTO agent_settings(owner_id) VALUES ($1)
       ON CONFLICT (owner_id) DO NOTHING`,
      [candidate.id],
    );
    console.info(JSON.stringify({ event: "bootstrap.completed", candidateCreated: candidate.created, adminCreated: admin.created }));
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bootstrap error";
  console.error(JSON.stringify({ event: "bootstrap.failed", message }));
  process.exitCode = 1;
});
