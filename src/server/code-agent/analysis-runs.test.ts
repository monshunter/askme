import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeConfig } from "@/server/config";

import { loadConfigFromSources } from "@/server/config";

import { queueConversationAnalysisRun, queueRepositoryAnalysisRun } from "./analysis-runs";

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

describe("Conversation Analysis queue usage boundary", () => {
  it("queues a real Conversation Deep run without reading or consuming daily quota usage", async () => {
    const runId = "66666666-6666-4666-8666-666666666666";
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
      if (sql.includes("FROM messages assistant")) return { rows: [{
        revisionId: "33333333-3333-4333-8333-333333333333",
        mode: "public",
        publicationId: "44444444-4444-4444-8444-444444444444",
        visitorTokenHash: "visitor-hash",
        visibility: "public_preview",
        publicDeepAnalysisEnabled: true,
      }] };
      if (sql.includes("INSERT INTO analysis_runs")) return { rows: [{
        id: runId,
        state: "pending",
        phase: "pending",
        revisionId: "33333333-3333-4333-8333-333333333333",
        assistantMessageId: "55555555-5555-4555-8555-555555555555",
        inserted: true,
      }] };
      if (sql.includes("INSERT INTO analysis_run_events") || sql.includes("INSERT INTO audit_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
    const config = loadConfigFromSources({ ASKME_CODE_AGENT_IMAGE_DIGEST: `sha256:${"a".repeat(64)}` }, "");

    await expect(queueConversationAnalysisRun({
      pool,
      config,
      ownerId: "11111111-1111-4111-8111-111111111111",
      repositoryId: "22222222-2222-4222-8222-222222222222",
      conversationId: "77777777-7777-4777-8777-777777777777",
      assistantMessageId: "55555555-5555-4555-8555-555555555555",
      clientMessageId: "deep-question-1",
      actorRole: "interviewer",
    })).resolves.toMatchObject({ id: runId, replayed: false });

    expect(query.mock.calls.every(([sql]) => !String(sql).includes("analysis_quota_usage"))).toBe(true);
  });
});
