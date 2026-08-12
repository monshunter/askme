import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";

import { hashPassword } from "../src/server/auth/crypto";

const databaseUrl = process.env.DATABASE_URL;
const action = process.argv[2];
const fixtureEmail = "askme-browser-e2e@local.invalid";
const fixturePassword = "Askme-browser-e2e-local-2026!";
const adminFixtureEmail = "askme-browser-admin-e2e@local.invalid";
const adminFixturePassword = "Askme-browser-admin-e2e-local-2026!";
const uploadRoot = process.env.UPLOAD_ROOT;

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (action !== "prepare" && action !== "cleanup") throw new Error("Usage: npm run e2e:fixture -- prepare|cleanup");

const parsedDatabaseUrl = new URL(databaseUrl);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsedDatabaseUrl.hostname)) {
  throw new Error("The browser fixture may only target a local database");
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
const existing = await client.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [fixtureEmail]);
let preparedOwnerId: string | null = null;

function minimalA4Pdf() {
  const stream = "BT /F1 18 Tf 72 770 Td (Askme A4 Source Preview) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

try {
  await client.query("BEGIN");
  await client.query(
    "DELETE FROM conversations WHERE owner_id IN (SELECT id FROM users WHERE email=ANY($1::text[]))",
    [[fixtureEmail, adminFixtureEmail]],
  );
  await client.query("DELETE FROM users WHERE email=$1", [fixtureEmail]);
  await client.query("DELETE FROM users WHERE email=$1", [adminFixtureEmail]);

  if (action === "prepare") {
    const ownerId = randomUUID();
    preparedOwnerId = ownerId;
    const materialId = randomUUID();
    const pdfMaterialId = randomUUID();
    const textMaterialId = randomUUID();
    const chunkId = randomUUID();
    const pdfChunkId = randomUUID();
    const textChunkId = randomUUID();
    const knowledgeItemId = randomUUID();
    const previewConversationId = randomUUID();
    const previewQuestionId = randomUUID();
    const previewAnswerId = randomUUID();

    await client.query(
      `INSERT INTO users(id,email,password_hash,role,display_name,headline,location,bio)
       VALUES ($1,$2,$3,'candidate','Taylor Chen','AI Agent Engineer','Shanghai','Builds trustworthy career knowledge Agents with grounded evidence.')`,
      [ownerId, fixtureEmail, await hashPassword(fixturePassword)],
    );
    await client.query(
      `INSERT INTO users(id,email,password_hash,role,display_name)
       VALUES ($1,$2,$3,'admin','Askme Browser Admin')`,
      [randomUUID(), adminFixtureEmail, await hashPassword(adminFixturePassword)],
    );
    await client.query(
      `INSERT INTO materials(id,owner_id,kind,title,original_name,mime_type,size_bytes,storage_path,status,visibility,summary,indexed_at)
       VALUES ($1,$2,'file','inkstone-career-agent.md','inkstone-career-agent.md','text/markdown',2048,$3,'indexed','public_preview','A citation-grounded recruiting Agent delivery.',now())`,
      [materialId, ownerId, `${ownerId}/${materialId}/inkstone-career-agent.md`],
    );
    await client.query(
      `INSERT INTO materials(id,owner_id,kind,title,original_name,mime_type,size_bytes,storage_path,status,visibility,summary,indexed_at)
       VALUES
         ($1,$3,'file','askme-source-preview.pdf','askme-source-preview.pdf','application/pdf',612,$4,'indexed','public_preview','A4 public source preview fixture.',now()),
         ($2,$3,'file','interview-notes.txt','interview-notes.txt','text/plain',48,$5,'indexed','citation_allowed','Citation name only fixture.',now())`,
      [pdfMaterialId, textMaterialId, ownerId, `${ownerId}/${pdfMaterialId}/askme-source-preview.pdf`, `${ownerId}/${textMaterialId}/interview-notes.txt`],
    );
    await client.query(
      `INSERT INTO chunks(id,material_id,owner_id,position,content,token_estimate)
       VALUES
         ($1,$2,$3,0,$4,48),
         ($5,$6,$3,0,'The source is an A4 PDF preview fixture.',12),
         ($7,$8,$3,0,'Interview notes are citation-name-only evidence.',12)`,
      [
        chunkId,
        materialId,
        ownerId,
        "What impact did the Inkstone Career Agent deliver? The Inkstone Career Agent reduced recruiter evidence review time by 42 percent in a measured pilot while preserving source-level citations.",
        pdfChunkId,
        pdfMaterialId,
        textChunkId,
        textMaterialId,
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
    await client.query(
      "INSERT INTO knowledge_sources(knowledge_item_id,material_id,owner_id) VALUES ($1,$2,$3)",
      [knowledgeItemId, materialId, ownerId],
    );
    await client.query("INSERT INTO privacy_policy_states(owner_id,revision) VALUES ($1,1)", [ownerId]);
    await client.query(
      "INSERT INTO conversations(id,owner_id,mode) VALUES ($1,$2,'preview')",
      [previewConversationId, ownerId],
    );
    await client.query(
      `INSERT INTO messages(id,conversation_id,owner_id,role,status,client_message_id,content)
       VALUES
         ($1::uuid,$3,$4,'user','completed',($1::uuid)::text,$5),
         ($2,$3,$4,'assistant','completed',NULL,$6)`,
      [
        previewQuestionId,
        previewAnswerId,
        previewConversationId,
        ownerId,
        "# Markdown question\n\n- Preserve this list",
        "## Grounded answer\n\n- Markdown stays structured\n- Sources remain authorized\n\n| Evidence | State |\n| --- | --- |\n| Citation | Current |\n\n```ts\nconst grounded = true;\n```\n\n<script>window.__chatUnsafe = true</script>",
      ],
    );
    await client.query(
      `INSERT INTO message_citations(message_id,chunk_id,owner_id,rank,excerpt)
       VALUES
         ($1,$2,$5,1,'Markdown public preview source.'),
         ($1,$3,$5,2,'PDF public preview source.'),
         ($1,$4,$5,3,'Citation name only source.')`,
      [previewAnswerId, chunkId, pdfChunkId, textChunkId, ownerId],
    );

    if (uploadRoot) {
      const markdown = [
        "# Source preview heading",
        "",
        "- Grounded evidence",
        "- Current authorization",
        "",
        "| Capability | Result |",
        "| --- | --- |",
        "| Markdown | Rendered |",
        "",
        "```ts",
        "const access = \"public_preview\";",
        "```",
        "",
        "<script>window.__askmeUnsafe = true</script>",
      ].join("\n");
      for (const [id, fileName, content] of [
        [materialId, "inkstone-career-agent.md", markdown],
        [pdfMaterialId, "askme-source-preview.pdf", minimalA4Pdf()],
        [textMaterialId, "interview-notes.txt", "Interview notes source fixture.\n"],
      ] as const) {
        const directory = path.join(uploadRoot, ownerId, id);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(path.join(directory, fileName), content, { mode: 0o600 });
      }
    }
  }

  await client.query("COMMIT");
  if (uploadRoot && existing.rows[0]) await rm(path.join(uploadRoot, existing.rows[0].id), { recursive: true, force: true });
  console.log(JSON.stringify({ event: `browser-fixture.${action}.completed`, email: fixtureEmail }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  if (uploadRoot && preparedOwnerId) await rm(path.join(uploadRoot, preparedOwnerId), { recursive: true, force: true }).catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
