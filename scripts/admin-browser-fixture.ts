import { randomBytes, randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";

import { Client } from "pg";

import { hashPassword } from "../src/server/auth/crypto";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const statePath = process.env.ASKME_ADMIN_FIXTURE_STATE ?? "/tmp/askme-admin-browser-fixture.json";
const command = process.argv[2];
const db = new Client({ connectionString: databaseUrl });

type FixtureState = {
  candidateId: string;
  publicationId: string;
  flagIds: string[];
  candidateName: string;
  slug: string;
  reviewSummary: string;
};

function validState(value: unknown): value is FixtureState {
  if (!value || typeof value !== "object") return false;
  const state = value as FixtureState;
  return /^[0-9a-f-]{36}$/.test(state.candidateId)
    && /^[0-9a-f-]{36}$/.test(state.publicationId)
    && state.flagIds.length === 2
    && state.flagIds.every((id) => /^[0-9a-f-]{36}$/.test(id));
}

async function setup() {
  await readFile(statePath, "utf8").then(() => { throw new Error(`Fixture state already exists at ${statePath}; run cleanup first.`); }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  });
  const candidateId = randomUUID();
  const materialId = randomUUID();
  const chunkId = randomUUID();
  const knowledgeId = randomUUID();
  const publicationId = randomUUID();
  const flagIds = [randomUUID(), randomUUID()];
  const candidateName = `Chrome Evidence ${candidateId.slice(0, 8)}`;
  const slug = randomBytes(24).toString("base64url");
  const reviewSummary = `Chrome governance review ${candidateId.slice(0, 8)}`;
  await db.query("BEGIN");
  try {
    await db.query(
      `INSERT INTO users(id,email,password_hash,role,status,display_name,headline,location,bio)
       VALUES ($1,$2,$3,'candidate','active',$4,'Grounded Agent Engineer','Singapore','Builds public citation-grounded career Agents.')`,
      [candidateId, `${candidateId}@local.invalid`, await hashPassword("Chrome-admin-fixture-2026!"), candidateName],
    );
    await db.query(
      `INSERT INTO materials(id,owner_id,kind,title,storage_path,status,visibility,indexed_at)
       VALUES ($1,$2,'file','Chrome public evidence',$3,'indexed','public_preview',now())`,
      [materialId, candidateId, `${candidateId}/${materialId}/evidence.md`],
    );
    await db.query(
      "INSERT INTO chunks(id,material_id,owner_id,position,content,token_estimate) VALUES ($1,$2,$3,0,'Delivered a governed citation-grounded public Agent.',8)",
      [chunkId, materialId, candidateId],
    );
    await db.query(
      `INSERT INTO knowledge_items(id,owner_id,type,title,summary,highlights,confidence)
       VALUES ($1,$2,'project','Governed public Agent','A constructed public project for Chrome acceptance.','["Citation grounded"]'::jsonb,1)`,
      [knowledgeId, candidateId],
    );
    await db.query("INSERT INTO knowledge_evidence(knowledge_item_id,chunk_id,owner_id) VALUES ($1,$2,$3)", [knowledgeId, chunkId, candidateId]);
    await db.query("INSERT INTO agent_settings(owner_id,public_mode,privacy_safe_mode,suggested_questions) VALUES ($1,true,true,'[]'::jsonb)", [candidateId]);
    await db.query("INSERT INTO publications(id,owner_id,slug,status,published_at) VALUES ($1,$2,$3,'published',now())", [publicationId, candidateId, slug]);
    await db.query(
      `INSERT INTO content_flags(id,publication_id,category,severity,safe_summary)
       VALUES ($1,$3,'privacy_boundary','high',$4),($2,$3,'visitor_negative_feedback','low','Chrome negative feedback review item.')`,
      [flagIds[0], flagIds[1], publicationId, reviewSummary],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  const state = { candidateId, publicationId, flagIds, candidateName, slug, reviewSummary } satisfies FixtureState;
  await writeFile(statePath, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.info(JSON.stringify({ event: "fixture.admin-browser.ready", candidateName, publicPath: `/a/${slug}`, reviewSummary, statePath }));
}

async function cleanup() {
  const value = JSON.parse(await readFile(statePath, "utf8")) as unknown;
  if (!validState(value)) throw new Error("Refusing cleanup because the fixture state file is invalid.");
  await db.query("BEGIN");
  try {
    await db.query("DELETE FROM audit_events WHERE target_id=ANY($1::text[])", [[value.candidateId, value.publicationId, ...value.flagIds]]);
    await db.query("DELETE FROM users WHERE id=$1", [value.candidateId]);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  await unlink(statePath);
  console.info(JSON.stringify({ event: "fixture.admin-browser.cleaned", candidateId: value.candidateId }));
}

await db.connect();
try {
  if (command === "setup") await setup();
  else if (command === "cleanup") await cleanup();
  else throw new Error("Use `npm run e2e:admin-fixture -- setup` or `-- cleanup`.");
} finally {
  await db.end();
}
