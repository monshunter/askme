import { readFile } from "node:fs/promises";
import path from "node:path";

import { getRuntimeConfig } from "../src/server/config";

const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const config = getRuntimeConfig();
  const email = config.bootstrap.candidateEmail;
  const password = config.bootstrap.candidatePassword;
  assert(email && password, "Candidate smoke credentials are not configured");

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password }),
    redirect: "manual",
  });
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert(login.status === 303 && cookie, `Candidate login failed with ${login.status}`);

  const sourcePath = path.resolve(process.env.ASKME_SMOKE_FILE ?? "SPEC.md");
  const bytes = await readFile(sourcePath);
  const form = new FormData();
  form.append("files", new File([bytes], path.basename(sourcePath), { type: "text/markdown" }));

  const upload = await fetch(`${baseUrl}/api/materials/upload`, { method: "POST", headers: { cookie }, body: form });
  const payload = (await upload.json()) as {
    data?: { items?: Array<{ ok: boolean; material?: { id: string; title: string; status: string; visibility: string } }>; failures?: number };
    error?: { code?: string };
  };
  const item = payload.data?.items?.[0];
  assert(upload.status === 201 && payload.data?.failures === 0 && item?.ok && item.material, `Upload failed with ${upload.status}:${payload.error?.code ?? "unknown"}`);
  assert(item.material.status === "queued" && item.material.visibility === "private", "Uploaded material did not start queued and private");

  console.info(JSON.stringify({ event: "smoke.upload.completed", material: item.material }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown upload smoke failure";
  console.error(JSON.stringify({ event: "smoke.upload.failed", message }));
  process.exitCode = 1;
});
