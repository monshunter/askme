import { randomUUID } from "node:crypto";

import { Pool } from "pg";

import { searchEvidence } from "../src/server/agent/retrieval";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const ownerId = randomUUID();
const otherOwnerId = randomUUID();
const marker = `visibility-${randomUUID()}`;

try {
  await pool.query(
    `INSERT INTO users(id,email,password_hash,role,display_name)
     VALUES ($1,$2,'fixture','candidate','Visibility Owner'),($3,$4,'fixture','candidate','Other Owner')`,
    [ownerId, `${ownerId}@local.invalid`, otherOwnerId, `${otherOwnerId}@local.invalid`],
  );
  for (const [index, visibility] of ["private", "agent_only", "citation_allowed", "public_preview"].entries()) {
    const materialId = randomUUID();
    await pool.query(
      `INSERT INTO materials(id,owner_id,kind,title,storage_path,external_url,status,visibility)
       VALUES ($1,$2,'website',$3,$4,$5,'indexed',$6)`,
      [materialId, ownerId, `Fixture ${visibility}`, `${ownerId}/${materialId}/source.txt`, `https://example.com/${index}`, visibility],
    );
    await pool.query("INSERT INTO chunks(material_id,owner_id,position,content,token_estimate) VALUES ($1,$2,0,$3,10)", [
      materialId,
      ownerId,
      `${marker} ${visibility}`,
    ]);
  }
  const otherMaterialId = randomUUID();
  await pool.query(
    `INSERT INTO materials(id,owner_id,kind,title,storage_path,external_url,status,visibility)
     VALUES ($1,$2,'website','Other owner',$3,'https://example.com/other','indexed','public_preview')`,
    [otherMaterialId, otherOwnerId, `${otherOwnerId}/${otherMaterialId}/source.txt`],
  );
  await pool.query("INSERT INTO chunks(material_id,owner_id,position,content,token_estimate) VALUES ($1,$2,0,$3,10)", [
    otherMaterialId,
    otherOwnerId,
    `${marker} other-owner`,
  ]);

  const preview = await searchEvidence(pool, ownerId, "candidate_preview", { query: marker, limit: 20 });
  const publicAnswer = await searchEvidence(pool, ownerId, "public_answer", { query: marker, limit: 20 });
  const publicHighlight = await searchEvidence(pool, ownerId, "public_highlight", { query: marker, limit: 20 });
  const values = (items: Awaited<ReturnType<typeof searchEvidence>>) => items.map((item) => item.visibility).sort();
  if (JSON.stringify(values(preview)) !== JSON.stringify(["agent_only", "citation_allowed", "public_preview"])) {
    throw new Error("Candidate preview visibility filtering failed");
  }
  if (JSON.stringify(values(publicAnswer)) !== JSON.stringify(["citation_allowed", "public_preview"])) {
    throw new Error("Public answer visibility filtering failed");
  }
  if (JSON.stringify(values(publicHighlight)) !== JSON.stringify(["public_preview"])) {
    throw new Error("Public highlight visibility filtering failed");
  }
  if ([...preview, ...publicAnswer, ...publicHighlight].some((item) => item.content.includes("other-owner"))) {
    throw new Error("Cross-owner evidence leaked into retrieval");
  }
  console.log(JSON.stringify({ event: "smoke.visibility-retrieval.completed", preview: preview.length, publicAnswer: publicAnswer.length, publicHighlight: publicHighlight.length, ownerIsolation: true }));
} finally {
  await pool.query("DELETE FROM users WHERE id IN ($1,$2)", [ownerId, otherOwnerId]).catch(() => undefined);
  await pool.end();
}
