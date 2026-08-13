import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";
const supportedMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else if (entry.name === "route.ts") files.push(target);
  }
  return files;
}

function probePath(file: string) {
  const route = `/api/${path.relative("src/app/api", path.dirname(file)).split(path.sep).join("/")}`;
  return route.replace(/\[([^\]]+)\]/g, (_match, parameter: string) => {
    if (parameter === "slug") return "surface-missing-agent";
    if (parameter === "token") return "a".repeat(43);
    return "00000000-0000-4000-8000-000000000000";
  });
}

function requestInit(method: string, requestId: string): RequestInit {
  const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
  return {
    method,
    redirect: "manual",
    headers: { "x-request-id": requestId, ...(hasBody ? { "content-type": "application/json" } : {}) },
    ...(hasBody ? { body: "{}" } : {}),
  };
}

let allowedMethodProbes = 0;
let rejectedMethodProbes = 0;
const serverErrors: Array<{ method: string; path: string; status: number }> = [];
for (const file of (await walk("src/app/api")).sort()) {
  const source = await readFile(file, "utf8");
  const methods = [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1]!);
  const url = new URL(probePath(file), baseUrl);
  for (const method of methods) {
    const requestId = `surface-${randomUUID()}`;
    const response = await fetch(url, requestInit(method, requestId));
    if (response.status === 405 || response.status === 501) throw new Error(`${method} ${url.pathname} was not registered`);
    if (response.status >= 500 && !(url.pathname === "/api/health/ready" && response.status === 503)) {
      serverErrors.push({ method, path: url.pathname, status: response.status });
    }
    if (response.headers.get("x-request-id") !== requestId) throw new Error(`${method} ${url.pathname} did not preserve the safe request id`);
    const contentType = response.headers.get("content-type") ?? "";
    if (response.status !== 204 && (response.status < 300 || response.status >= 400) && !contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
      throw new Error(`${method} ${url.pathname} returned an unexpected content type ${contentType || "none"}`);
    }
    allowedMethodProbes += 1;
  }
  const rejectedMethod = supportedMethods.find((method) => !methods.includes(method));
  if (!rejectedMethod) throw new Error(`${url.pathname} unexpectedly declares every supported method`);
  const rejected = await fetch(url, requestInit(rejectedMethod, `surface-rejected-${randomUUID()}`));
  if (rejected.status !== 405) throw new Error(`${rejectedMethod} ${url.pathname} should return 405 but returned ${rejected.status}`);
  rejectedMethodProbes += 1;
}

if (serverErrors.length > 0) throw new Error(`API surface returned server errors: ${JSON.stringify(serverErrors)}`);

console.info(JSON.stringify({ event: "smoke.api-surface.completed", apiRoutes: rejectedMethodProbes, allowedMethodProbes, rejectedMethodProbes, anonymousOnly: true, businessSemanticsDelegated: true }));
