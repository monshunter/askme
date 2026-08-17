import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prepareHostRunnerEnvironment } from "../src/server/code-agent/host-runner-environment";

async function optionalFile(pathname: string) {
  try {
    return await readFile(pathname, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectEnvFile = await optionalFile(path.join(projectRoot, ".env"));
const userEnvFile = await optionalFile(path.join(os.homedir(), ".env"));
const environment = prepareHostRunnerEnvironment({ processEnv: process.env, projectEnvFile, userEnvFile, projectRoot });

if (!environment.ASKME_CODE_AGENT_IMAGE_DIGEST) {
  const index = JSON.parse(await readFile(path.join(environment.ASKME_CODE_AGENT_ROOTFS_PATH, "index.json"), "utf8")) as { manifests?: Array<{ digest?: unknown }> };
  const digest = index.manifests?.[0]?.digest;
  if (typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error("ASKME_CODE_AGENT_IMAGE_DIGEST is unavailable from the configured OCI layout");
  environment.ASKME_CODE_AGENT_IMAGE_DIGEST = digest;
}

for (const [key, value] of Object.entries(environment)) process.env[key] = value;
delete process.env.ASKME_GITHUB_TEST_TOKEN;
process.chdir(projectRoot);
await import("../src/agent-runner");
