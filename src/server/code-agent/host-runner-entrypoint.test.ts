import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function waitForTrace(pathname: string, marker: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const trace = await readFile(pathname, "utf8").catch(() => "");
    if (trace.includes(marker)) return trace;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return readFile(pathname, "utf8");
}

async function runDockerUp(skipRunner = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "askme-runner-entrypoint-"));
  temporaryRoots.push(root);
  const bin = path.join(root, "bin");
  const trace = path.join(root, "trace.log");
  await mkdir(bin);
  for (const command of ["docker", "nohup", "npm"]) {
    const script = path.join(bin, command);
    await writeFile(script, `#!/bin/sh\nprintf '%s:%s\\n' '${command}' \"$*\" >> \"$TRACE_FILE\"\n`, "utf8");
    await chmod(script, 0o755);
  }

  const result = spawnSync("bash", ["scripts/docker-up.sh", "-d"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: root,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TRACE_FILE: trace,
      ASKME_AGENT_RUNNER_STATE_ROOT: path.join(root, "state"),
      ASKME_CODE_AGENT_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
      ...(skipRunner ? { ASKME_SKIP_AGENT_RUNNER: "1" } : {}),
    },
  });
  return { result, trace: await waitForTrace(trace, skipRunner ? "docker:" : "nohup:") };
}

describe("local runtime entrypoint", () => {
  it("keeps Compose detached and starts the host Runner through cross-platform nohup", async () => {
    const { result, trace } = await runDockerUp();

    expect(result.status).toBe(0);
    expect(trace).toMatch(/docker:compose .*up --build -d/);
    expect(trace).toContain(`nohup:${path.join(process.cwd(), "scripts/agent-runner.sh")}`);
    expect(result.stdout).toContain("Agent Runner start requested with nohup");
  });

  it("supports explicit Compose-only operation", async () => {
    const skipped = await runDockerUp(true);

    expect(skipped.result.status).toBe(0);
    expect(skipped.trace).not.toContain("nohup:");
  });
});
