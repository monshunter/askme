import { randomUUID } from "node:crypto";

import { Client } from "pg";

import { hashPassword } from "../src/server/auth/crypto";

const databaseUrl = process.env.DATABASE_URL;
const action = process.argv[2];
const fixtureEmail = "askme-browser-e2e@local.invalid";
const fixturePassword = "Askme-browser-e2e-local-2026!";

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (action !== "prepare" && action !== "cleanup") throw new Error("Usage: npm run e2e:fixture -- prepare|cleanup");

const parsedDatabaseUrl = new URL(databaseUrl);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsedDatabaseUrl.hostname)) {
  throw new Error("The browser fixture may only target a local database");
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query("BEGIN");
  await client.query("DELETE FROM users WHERE email=$1", [fixtureEmail]);

  if (action === "prepare") {
    const ownerId = randomUUID();
    const materialId = randomUUID();
    const chunkId = randomUUID();
    const knowledgeItemId = randomUUID();

    await client.query(
      `INSERT INTO users(id,email,password_hash,role,display_name,headline,location,bio)
       VALUES ($1,$2,$3,'candidate','Taylor Chen','AI Agent Engineer','Shanghai','Builds trustworthy career knowledge Agents with grounded evidence.')`,
      [ownerId, fixtureEmail, await hashPassword(fixturePassword)],
    );
    await client.query(
      `INSERT INTO materials(id,owner_id,kind,title,original_name,mime_type,size_bytes,storage_path,status,visibility,summary,indexed_at)
       VALUES ($1,$2,'file','Inkstone Career Agent case study','inkstone-career-agent.md','text/markdown',2048,$3,'indexed','public_preview','A citation-grounded recruiting Agent delivery.',now())`,
      [materialId, ownerId, `${ownerId}/${materialId}/inkstone-career-agent.md`],
    );
    await client.query(
      `INSERT INTO chunks(id,material_id,owner_id,position,content,token_estimate)
       VALUES ($1,$2,$3,0,$4,48)`,
      [
        chunkId,
        materialId,
        ownerId,
        "What impact did the Inkstone Career Agent deliver? The Inkstone Career Agent reduced recruiter evidence review time by 42 percent in a measured pilot while preserving source-level citations.",
      ],
    );
    await client.query(
      `INSERT INTO knowledge_items(id,owner_id,type,title,summary,highlights,confidence)
       VALUES ($1,$2,'project','Inkstone Career Agent','A trustworthy career knowledge Agent backed by source-level evidence.','["42 percent faster evidence review","Source-level citations"]'::jsonb,1)`,
      [knowledgeItemId, ownerId],
    );
    await client.query(
      "INSERT INTO knowledge_evidence(knowledge_item_id,chunk_id,owner_id) VALUES ($1,$2,$3)",
      [knowledgeItemId, chunkId, ownerId],
    );
    await client.query("INSERT INTO privacy_policy_states(owner_id,revision) VALUES ($1,1)", [ownerId]);
  }

  await client.query("COMMIT");
  console.log(JSON.stringify({ event: `browser-fixture.${action}.completed`, email: fixtureEmail }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
