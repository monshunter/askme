import { Pool } from "pg";

import { claimNextIngestionJob } from "../src/server/jobs/ingestion-jobs";
import { extractStoredMaterialText } from "../src/server/materials/text-extraction";

const baseUrl = process.env.ASKME_BASE_URL ?? "http://web:3000";
const databaseUrl = process.env.DATABASE_URL;
const uploadRoot = process.env.UPLOAD_ROOT ?? "/data/uploads";
const email = process.env.ASKME_CANDIDATE_EMAIL;
const password = process.env.ASKME_CANDIDATE_PASSWORD;
if (!databaseUrl || !email || !password) throw new Error("DATABASE_URL and Candidate smoke credentials are required");

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
if (!login.ok || !cookie) throw new Error(`Candidate login failed with status ${login.status}`);

const marker = `Lease extraction evidence ${Date.now()}`;
const form = new FormData();
form.append("files", new File([`# Lease test\n${marker}`], "lease-test.md", { type: "text/markdown" }));
const upload = await fetch(`${baseUrl}/api/materials/upload`, { method: "POST", headers: { cookie }, body: form });
const uploadPayload = (await upload.json()) as { data?: { items?: Array<{ material?: { id: string } }> } };
const materialId = uploadPayload.data?.items?.[0]?.material?.id;
if (upload.status !== 201 || !materialId) throw new Error(`Lease smoke upload failed with status ${upload.status}`);

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
let materialDeleted = false;
try {
  await pool.query("UPDATE ingestion_jobs SET next_run_at='2000-01-01' WHERE material_id=$1", [materialId]);
  const first = await claimNextIngestionJob(pool, "smoke-worker-a", 60_000);
  if (!first || first.material.id !== materialId || first.attempt !== 1) throw new Error("The due job was not leased exactly once");
  const extracted = await extractStoredMaterialText(first.material, uploadRoot);
  if (!extracted.includes(marker)) throw new Error("The leased material was not extracted from owner storage");

  await pool.query("UPDATE ingestion_jobs SET lease_expires_at=now()-interval '1 second',next_run_at='2000-01-01' WHERE id=$1", [first.jobId]);
  const recovered = await claimNextIngestionJob(pool, "smoke-worker-b", 60_000);
  if (!recovered || recovered.jobId !== first.jobId || recovered.attempt !== 2 || recovered.leaseOwner !== "smoke-worker-b") {
    throw new Error("An expired lease was not recovered by a different worker");
  }
  const secondExtraction = await extractStoredMaterialText(recovered.material, uploadRoot);
  if (secondExtraction !== extracted) throw new Error("Lease recovery changed the extracted source text");

  const deleted = await fetch(`${baseUrl}/api/materials/${materialId}`, { method: "DELETE", headers: { cookie } });
  if (!deleted.ok) throw new Error(`Lease smoke cleanup failed with status ${deleted.status}`);
  materialDeleted = true;
  console.log(JSON.stringify({ event: "smoke.job-lease.completed", firstAttempt: first.attempt, recoveredAttempt: recovered.attempt, extractionBytes: Buffer.byteLength(extracted) }));
} finally {
  if (!materialDeleted) {
    await fetch(`${baseUrl}/api/materials/${materialId}`, { method: "DELETE", headers: { cookie } }).catch(() => undefined);
  }
  await pool.end();
}
