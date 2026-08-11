import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";

type StoredState = {
  marker: string;
  cookie: string;
  materialId: string;
  storagePath: string;
  checksum: string;
  jobId: string;
  loginRequestId: string;
  uploadRequestId: string;
};

type Snapshot = {
  materialId: string;
  status: string;
  storagePath: string;
  checksum: string;
  errorCode: string | null;
  jobId: string;
  jobStatus: string;
  jobErrorCode: string | null;
  knowledgeCount: number;
  activeSessions: number;
  migrationCount: number;
  uploadRequestId: string | null;
  indexedAuditJobId: string | null;
};

const action = process.argv[2];
const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";
const databaseUrl = process.env.DATABASE_URL;
const email = process.env.ASKME_CANDIDATE_EMAIL;
const password = process.env.ASKME_CANDIDATE_PASSWORD;
const project = process.env.ASKME_ACCEPTANCE_PROJECT;
const marker = process.env.ASKME_ACCEPTANCE_MARKER;
const statePath = process.env.ASKME_ACCEPTANCE_STATE_PATH;
const uploadRoot = process.env.UPLOAD_ROOT;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(action === "seed" || action === "verify", "Usage: smoke-runtime-state.ts seed|verify");
assert(databaseUrl && email && password && project && marker && statePath && uploadRoot, "Acceptance runtime state is not fully configured");
assert(/^askme-acceptance-[0-9]+-[0-9]+$/.test(project), "Refusing a non-acceptance Docker project");
assert(marker === project, "Acceptance marker must equal the isolated project name");

const acceptanceMarker = marker;
const acceptanceUploadRoot = uploadRoot;
const acceptanceStateRoot = path.resolve(acceptanceUploadRoot, ".askme-acceptance");
const resolvedStatePath = path.resolve(statePath);
assert(path.dirname(resolvedStatePath) === acceptanceStateRoot, "Acceptance state must stay inside the isolated upload volume");
assert(path.basename(resolvedStatePath) === `${acceptanceMarker}.json`, "Acceptance state filename does not match the project marker");

const privateText = `ASKME_PRIVATE_TEXT_${acceptanceMarker}`;
const requestPrefix = acceptanceMarker.replaceAll("-", ".");

async function jsonRequest<T>(url: string, init: RequestInit, expectedRequestId: string) {
  const response = await fetch(url, { ...init, headers: { ...init.headers, "x-request-id": expectedRequestId } });
  const payload = (await response.json()) as { data: T | null; error: { code: string; message: string } | null; requestId?: string };
  assert(response.headers.get("x-request-id") === expectedRequestId, `Response header did not preserve ${expectedRequestId}`);
  assert(payload.requestId === expectedRequestId, `Response envelope did not preserve ${expectedRequestId}`);
  return { response, payload };
}

async function login() {
  const loginRequestId = `${requestPrefix}.login`;
  const { response, payload } = await jsonRequest<{ user: { email: string }; destination: string }>(
    `${baseUrl}/api/auth/login`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    loginRequestId,
  );
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(response.ok && cookie && payload.data?.user.email === email, `Acceptance login failed with ${response.status}:${payload.error?.code ?? "unknown"}`);
  return { cookie, loginRequestId };
}

async function snapshot(client: Client, materialId: string): Promise<Snapshot | null> {
  const result = await client.query<Snapshot>(
    `SELECT m.id AS "materialId",m.status,m.storage_path AS "storagePath",m.content_checksum AS checksum,m.error_code AS "errorCode",
            j.id AS "jobId",j.status AS "jobStatus",j.last_error_code AS "jobErrorCode",
            (SELECT count(*)::int FROM knowledge_sources source WHERE source.material_id=m.id) AS "knowledgeCount",
            (SELECT count(*)::int FROM sessions session WHERE session.user_id=m.owner_id AND session.revoked_at IS NULL AND session.expires_at>now()) AS "activeSessions",
            (SELECT count(*)::int FROM schema_migrations) AS "migrationCount",
            (SELECT request_id FROM audit_events event WHERE event.target_id=m.id::text AND event.action='material.upload' ORDER BY created_at DESC LIMIT 1) AS "uploadRequestId",
            (SELECT metadata->>'jobId' FROM audit_events event WHERE event.target_id=m.id::text AND event.action='material.index' ORDER BY created_at DESC LIMIT 1) AS "indexedAuditJobId"
       FROM materials m
       JOIN ingestion_jobs j ON j.material_id=m.id
      WHERE m.id=$1`,
    [materialId],
  );
  return result.rows[0] ?? null;
}

async function fileChecksum(storagePath: string) {
  const bytes = await readFile(path.resolve(acceptanceUploadRoot, storagePath));
  return createHash("sha256").update(bytes).digest("hex");
}

async function waitForIndexed(client: Client, materialId: string) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const current = await snapshot(client, materialId);
    if (current?.status === "indexed" && current.jobStatus === "completed" && current.knowledgeCount > 0) return current;
    if (current?.status === "failed") throw new Error(`Acceptance material failed with ${current.errorCode ?? current.jobErrorCode ?? current.jobStatus}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Acceptance material did not reach indexed before the deadline");
}

async function seed(client: Client) {
  const { cookie, loginRequestId } = await login();
  const uploadRequestId = `${requestPrefix}.upload`;
  const form = new FormData();
  const contents = `# Runtime persistence acceptance\n\nThe candidate designed and delivered a citation-grounded career knowledge Agent for recruiting teams. They owned the TypeScript application, PostgreSQL data model, background ingestion worker, privacy controls, and Docker runtime. In a measured pilot, the system reduced recruiter evidence review time by 42 percent while preserving source-level citations and candidate-controlled visibility.\n\n${privateText}\n`;
  form.append("files", new File([contents], `${acceptanceMarker}.md`, { type: "text/markdown" }));
  const { response, payload } = await jsonRequest<{ items: Array<{ ok: boolean; material?: { id: string } }>; failures: number }>(
    `${baseUrl}/api/materials/upload`,
    { method: "POST", headers: { cookie }, body: form },
    uploadRequestId,
  );
  const materialId = payload.data?.items[0]?.material?.id;
  assert(response.status === 201 && payload.data?.failures === 0 && materialId, `Acceptance upload failed with ${response.status}:${payload.error?.code ?? "unknown"}`);

  const current = await waitForIndexed(client, materialId);
  assert(current.uploadRequestId === uploadRequestId, "Upload audit did not preserve the request id");
  assert(current.indexedAuditJobId === current.jobId, "Worker audit did not preserve the ingestion job id");
  assert(current.activeSessions > 0 && current.migrationCount > 0, "Acceptance account, session, or migration state is incomplete");
  assert((await fileChecksum(current.storagePath)) === current.checksum, "Uploaded file checksum does not match the database");

  await mkdir(acceptanceStateRoot, { recursive: true, mode: 0o700 });
  const state: StoredState = {
    marker: acceptanceMarker,
    cookie,
    materialId,
    storagePath: current.storagePath,
    checksum: current.checksum,
    jobId: current.jobId,
    loginRequestId,
    uploadRequestId,
  };
  await writeFile(resolvedStatePath, JSON.stringify(state), { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.info(JSON.stringify({ event: "smoke.runtime-state.seeded", project, materialId, jobId: current.jobId, knowledgeCount: current.knowledgeCount }));
}

async function verify(client: Client) {
  const state = JSON.parse(await readFile(resolvedStatePath, "utf8")) as StoredState;
  assert(state.marker === acceptanceMarker, "Persisted acceptance state belongs to another project");
  const verifyRequestId = `${requestPrefix}.verify`;
  const { response, payload } = await jsonRequest<{ user: { email: string } }>(
    `${baseUrl}/api/auth/me`,
    { headers: { cookie: state.cookie } },
    verifyRequestId,
  );
  assert(response.ok && payload.data?.user.email === email, "The pre-restart session did not resolve after restart");

  const current = await snapshot(client, state.materialId);
  assert(current, "The pre-restart material is missing");
  assert(current.status === "indexed" && current.jobStatus === "completed", "Material or job state changed across restart");
  assert(current.storagePath === state.storagePath && current.checksum === state.checksum, "Material file metadata changed across restart");
  assert(current.jobId === state.jobId && current.indexedAuditJobId === state.jobId, "Job trace changed across restart");
  assert(current.uploadRequestId === state.uploadRequestId, "Request audit changed across restart");
  assert(current.knowledgeCount > 0 && current.activeSessions > 0 && current.migrationCount > 0, "Persistent product state is incomplete after restart");
  assert((await fileChecksum(current.storagePath)) === current.checksum, "Uploaded file was not preserved across restart");

  console.info(
    JSON.stringify({
      event: "smoke.runtime-state.verified",
      project,
      materialId: current.materialId,
      jobId: current.jobId,
      knowledgeCount: current.knowledgeCount,
      activeSessions: current.activeSessions,
      requestAudit: true,
      fileChecksum: true,
    }),
  );
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  if (action === "seed") await seed(client);
  else await verify(client);
} finally {
  await client.end();
}
