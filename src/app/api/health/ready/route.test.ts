import { access } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({ access: vi.fn() }));
vi.mock("@/server/config", () => ({ getRuntimeConfig: vi.fn() }));
vi.mock("@/server/db/client", () => ({ getPool: vi.fn() }));

import { getRuntimeConfig } from "@/server/config";
import { getPool } from "@/server/db/client";

import { GET } from "./route";

const imageDigest = `sha256:${"a".repeat(64)}`;
const query = vi.fn();

function request() {
  return new Request("http://127.0.0.1:3000/api/health/ready", {
    headers: { "x-request-id": "ready-provenance-test" },
  });
}

function readyDatabase(runnerImageDigest: string | null) {
  query
    .mockResolvedValueOnce({ rows: [{}] })
    .mockResolvedValueOnce({ rows: [{ currentApplied: true }] })
    .mockResolvedValueOnce({ rows: [{ healthy: true }] })
    .mockResolvedValueOnce({ rows: [{ fresh: true, artifactReady: true, boxliteReady: true, imageDigest: runnerImageDigest }] });
}

describe("GET /api/health/ready", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPool).mockReturnValue({ query } as never);
    vi.mocked(access).mockResolvedValue(undefined);
  });

  it("does not report Code Agent ready when Web has no pinned image digest", async () => {
    vi.mocked(getRuntimeConfig).mockReturnValue({
      ai: { apiKey: "configured" },
      codeAgent: { imageDigest: null },
      repositoryArtifactRoot: "/tmp/askme-artifacts",
    } as never);
    readyDatabase(imageDigest);

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.capabilities.codeAgent).toBe("degraded");
    expect(payload.data.checks.provenance).toBe("unconfigured");
  });

  it("requires the Web and runner image digests to match", async () => {
    vi.mocked(getRuntimeConfig).mockReturnValue({
      ai: { apiKey: "configured" },
      codeAgent: { imageDigest },
      repositoryArtifactRoot: "/tmp/askme-artifacts",
    } as never);
    readyDatabase(`sha256:${"b".repeat(64)}`);

    const response = await GET(request());
    const payload = await response.json();

    expect(payload.data.capabilities.codeAgent).toBe("degraded");
    expect(payload.data.checks.provenance).toBe("mismatch");
  });

  it("reports Code Agent ready only when Web and runner use the same pinned image", async () => {
    vi.mocked(getRuntimeConfig).mockReturnValue({
      ai: { apiKey: "configured" },
      codeAgent: { imageDigest },
      repositoryArtifactRoot: "/tmp/askme-artifacts",
    } as never);
    readyDatabase(imageDigest);

    const response = await GET(request());
    const payload = await response.json();

    expect(payload.data.capabilities.codeAgent).toBe("ready");
    expect(payload.data.checks.provenance).toBe("ready");
  });
});
