import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeConfig } from "@/server/config";

import { queueRepositoryAnalysisRun } from "./analysis-runs";

describe("Repository Analysis queue authorization ordering", () => {
  it("rejects a private Repository before checking Code Agent runtime availability", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FROM repositories repository")) {
        return {
          rows: [{
            ownerId: "11111111-1111-4111-8111-111111111111",
            repositoryId: "22222222-2222-4222-8222-222222222222",
            revisionId: "33333333-3333-4333-8333-333333333333",
            visibility: "private",
            disabledAt: null,
            state: "stored",
            artifactChecksum: "a".repeat(64),
            filterFingerprint: "b".repeat(64),
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
    const config = {
      codeAgent: { imageDigest: null },
    } as unknown as RuntimeConfig;

    await expect(queueRepositoryAnalysisRun({
      pool,
      config,
      ownerId: "11111111-1111-4111-8111-111111111111",
      repositoryId: "22222222-2222-4222-8222-222222222222",
    })).rejects.toMatchObject({ code: "REPOSITORY_ANALYSIS_PRIVATE", status: 409 });
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });
});
