import { randomUUID } from "node:crypto";

import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
const fixtureEmail = "askme-browser-e2e@local.invalid";
const fixtureClientMessageId = "44444444-4444-4444-8444-444444444444";

if (!databaseUrl) throw new Error("DATABASE_URL is required");
const parsedDatabaseUrl = new URL(databaseUrl);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsedDatabaseUrl.hostname)) {
  throw new Error("The browser fixture may only target a local database");
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query("BEGIN");
  const context = await client.query<{ conversationId: string; ownerId: string; slug: string }>(
    `SELECT conversation.id AS "conversationId",conversation.owner_id AS "ownerId",publication.slug
     FROM conversations conversation
     JOIN publications publication ON publication.id=conversation.publication_id AND publication.owner_id=conversation.owner_id
     JOIN users candidate ON candidate.id=conversation.owner_id
     WHERE candidate.email=$1 AND conversation.mode='public' AND conversation.expires_at>now() AND publication.status='published'
     ORDER BY conversation.created_at DESC LIMIT 1
     FOR UPDATE OF conversation`,
    [fixtureEmail],
  );
  const current = context.rows[0];
  if (!current) throw new Error("Open the fixture public Agent page before seeding its thread");

  const existing = await client.query(
    "SELECT id FROM messages WHERE conversation_id=$1 AND client_message_id=$2",
    [current.conversationId, fixtureClientMessageId],
  );
  if (!existing.rows[0]) {
    const chunks = await client.query<{ chunkId: string; title: string }>(
      `SELECT chunk.id AS "chunkId",material.title
       FROM chunks chunk
       JOIN materials material ON material.id=chunk.material_id AND material.owner_id=chunk.owner_id
       WHERE chunk.owner_id=$1 AND material.title=ANY($2::text[])
       ORDER BY array_position($2::text[],material.title)`,
      [current.ownerId, ["inkstone-career-agent.md", "askme-source-preview.pdf", "interview-notes.txt"]],
    );
    if (chunks.rows.length !== 3) throw new Error("The public source fixture is incomplete");

    const questionId = randomUUID();
    const answerId = randomUUID();
    await client.query(
      `INSERT INTO messages(id,conversation_id,owner_id,role,status,client_message_id,content)
       VALUES
         ($1,$3,$4,'user','completed',$5,$6),
         ($2,$3,$4,'assistant','completed',NULL,$7)`,
      [
        questionId,
        answerId,
        current.conversationId,
        current.ownerId,
        fixtureClientMessageId,
        "# Public Markdown question\n\n- Keep the structure",
        "## Public grounded answer\n\n- Uses current authorization\n- Renders Markdown safely\n\n| Projection | Value |\n| --- | --- |\n| Source | Name only |\n\n```ts\nconst publicAnswer = true;\n```\n\n<script>window.__publicChatUnsafe = true</script>",
      ],
    );
    for (const [index, chunk] of chunks.rows.entries()) {
      await client.query(
        "INSERT INTO message_citations(message_id,chunk_id,owner_id,rank,excerpt) VALUES ($1,$2,$3,$4,$5)",
        [answerId, chunk.chunkId, current.ownerId, index + 1, `Private excerpt for ${chunk.title}`],
      );
    }
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ event: "browser-fixture.public-thread.completed", slug: current.slug }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
