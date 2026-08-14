import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadConfigFromSources } from "@/server/config";

import { activateIndexVersion, enqueueApprovedWikiSourcesForOpenIndexes, indexVersionDescriptor, markIndexVersionReady, startIndexRebuild } from "./index-coordinator";

describe("Hybrid RAG index coordinator", () => {
  it("fingerprints every Embedding and chunk identity input deterministically", () => {
    const base = loadConfigFromSources({
      ASKME_EMBEDDING_MODEL_API_KEY: "secret",
      ASKME_EMBEDDING_MODEL_API_BASE_URL: "https://embedding.example.test/v1",
    }, "");
    const first = indexVersionDescriptor(base);
    const second = indexVersionDescriptor(base);
    const changed = indexVersionDescriptor(loadConfigFromSources({
      ASKME_EMBEDDING_MODEL_API_KEY: "secret",
      ASKME_EMBEDDING_MODEL_API_BASE_URL: "https://embedding.example.test/v1",
      ASKME_RAG_CHILD_TARGET_TOKENS: "440",
    }, ""));

    expect(first).toEqual(second);
    expect(first.configFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.embeddingDimensions).toBe(1_024);
    expect(first.distanceMetric).toBe("cosine");
    expect(changed.configFingerprint).not.toBe(first.configFingerprint);
  });

  it("creates one idempotent building index and snapshots current Material and approved Wiki sources", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "index-v2" }] })
      .mockResolvedValueOnce({ rowCount: 2, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query, release }) };
    const config = loadConfigFromSources({}, "");

    const result = await startIndexRebuild(pool as never, config);

    expect(result).toEqual({ indexVersionId: "index-v2", expectedSourceCount: 3, reused: false });
    expect(query.mock.calls.map((call) => String(call[0]))).toEqual(expect.arrayContaining([
      expect.stringContaining("INSERT INTO rag_index_versions"),
      expect.stringContaining("INSERT INTO rag_source_versions"),
      expect.stringContaining("UPDATE rag_index_versions"),
    ]));
    expect(query.mock.calls.map((call) => String(call[0])).join("\n")).toContain("projection.state='approved'");
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("atomically activates only a complete ready index while superseding the previous active version", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "index-v2", state: "ready", expectedSourceCount: 3, readySourceCount: 3 }] })
      .mockResolvedValue({ rows: [] });
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query, release }) };

    await activateIndexVersion(pool as never, "index-v2");

    const sql = query.mock.calls.map((call) => String(call[0])).join("\n");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("state='superseded'");
    expect(sql).toContain("state='active'");
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("treats repeated activation of the same complete active index as success", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "index-v2", state: "active", expectedSourceCount: 3, readySourceCount: 3 }] })
      .mockResolvedValue({ rows: [] });
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query, release }) };

    await activateIndexVersion(pool as never, "index-v2");

    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    const sql = query.mock.calls.map((call) => String(call[0])).join("\n");
    expect(sql).toContain("state IN ('ready','ready_with_warnings','active')");
    expect(sql).not.toContain("SET state='superseded'");
  });

  it("treats an index already made ready by a concurrent worker as ready", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ready: true }] });
    const pool = { query };

    await expect(markIndexVersionReady(pool as never, "index-v2")).resolves.toBe(true);
    expect(String(query.mock.calls[1]?.[0])).toContain("state IN ('ready','active')");
  });

  it("requeues a revoked approved Wiki on visibility restore and reconciles open index counts", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ indexVersionId: "index-v2" }] });
    const pool = { query };

    await enqueueApprovedWikiSourcesForOpenIndexes(pool as never, "owner", "repository");

    expect(String(query.mock.calls[0]?.[0])).toContain("SET state='superseded'");
    expect(String(query.mock.calls[0]?.[0])).toContain("source.metadata->>'projectionId'<>repository.active_projection_id::text");
    expect(String(query.mock.calls[1]?.[0])).toContain("DO UPDATE SET\n         state='queued'");
    expect(String(query.mock.calls[1]?.[0])).toContain("revoked_at=NULL");
    expect(String(query.mock.calls[2]?.[0])).toContain("state NOT IN ('revoked','superseded')");
  });

  it("defines an additive pgvector migration with exact-search storage and one active version", () => {
    const sql = readFileSync(path.resolve(process.cwd(), "migrations/0021_hybrid_rag_v2.sql"), "utf8");

    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    expect(sql).toContain("CREATE TABLE rag_index_versions");
    expect(sql).toContain("CREATE TABLE rag_source_versions");
    expect(sql).toContain("CREATE TABLE rag_parent_chunks");
    expect(sql).toContain("CREATE TABLE rag_child_chunks");
    expect(sql).toContain("embedding vector(1024)");
    expect(sql).toContain("WHERE state='active'");
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    expect(sql).not.toContain("USING hnsw");
  });
});
