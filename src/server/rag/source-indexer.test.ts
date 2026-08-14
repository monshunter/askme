import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { loadConfigFromSources } from "@/server/config";

import { buildEmbeddedSource, claimNextRagSource } from "./source-indexer";

describe("RAG source index worker", () => {
  it("claims one queued or expired source with SKIP LOCKED and a bounded lease", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "source", ownerId: "owner", sourceKind: "material", sourceId: "material", sourceRevision: "revision", indexVersionId: "index", metadata: { title: "Resume" } }] })
      .mockResolvedValueOnce({ rows: [{ leaseExpiresAt: new Date("2026-08-14T08:00:00Z") }] })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as Pool;

    const lease = await claimNextRagSource(pool, "worker-1", 60_000);

    expect(lease).toMatchObject({ sourceVersionId: "source", leaseOwner: "worker-1", sourceKind: "material" });
    expect(String(query.mock.calls[1]?.[0])).toContain("FOR UPDATE OF source SKIP LOCKED");
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("batches contextual Child text through the independent Embedding client", async () => {
    const config = loadConfigFromSources({ ASKME_EMBEDDING_BATCH_SIZE: "2" }, "");
    const embed = vi.fn().mockImplementation(async (input: string[]) => ({
      vectors: input.map((_value, index) => Array.from({ length: 1_024 }, () => index / 10)),
      inputTokens: input.length * 10,
    }));
    const text = Array.from({ length: 80 }, (_, index) => `## Section ${index}\n\n${"Career evidence ".repeat(30)}${index}`).join("\n\n");

    const result = await buildEmbeddedSource({ text, sourceRevision: "material-v1", sourceTitle: "Resume", config, embeddingClient: { embed } });

    expect(result.parents.length).toBeGreaterThan(1);
    expect(result.children.length).toBeGreaterThan(2);
    expect(embed.mock.calls.every((call) => call[0].length <= 2)).toBe(true);
    expect(embed.mock.calls.flatMap((call) => call[0]).every((value) => value.includes("Source: Resume"))).toBe(true);
    expect(result.children.every((child) => child.embedding.length === 1_024)).toBe(true);
    expect(result.inputTokens).toBe(result.children.length * 10);
  });

  it("supersedes only the same Repository document family after an active-index requeue", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/server/rag/source-indexer.ts"), "utf8");

    expect(source).toContain("current.evidence_family_id=incoming.evidence_family_id");
    expect(source).toContain("$3::rag_source_kind NOT IN ('repository_markdown','repository_pdf')");
  });
});
