import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ getPool: vi.fn() }));

import { getPool } from "@/server/db/client";

import { listKnowledge } from "./knowledge-service";

const query = vi.fn();

describe("unified knowledge list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPool).mockReturnValue({ query } as never);
  });

  it("counts and returns one current active Approved Repository Wiki beside Knowledge Items", async () => {
    query
      .mockResolvedValueOnce({ rows: [{
        id: "22222222-2222-4222-8222-222222222222",
        sourceKind: "repository_wiki",
        type: "repository",
        status: "active",
        title: "Copybook Generator — Repository Wiki",
        summary: "Approved repository knowledge",
        highlights: [],
        confidence: null,
        sourceCount: 1,
        chunkCount: 0,
        wikiPageCount: 6,
        sourceTitles: ["monshunter/copybook"],
        sourceVisibilities: ["public_preview"],
        citationReady: true,
        createdAt: new Date("2026-08-14T00:00:00Z"),
        updatedAt: new Date("2026-08-14T00:00:00Z"),
      }, {
        id: "11111111-1111-4111-8111-111111111111",
        sourceKind: "knowledge_item",
        type: "project",
        status: "active",
        title: "Askme",
        summary: "Career knowledge",
        highlights: [],
        confidence: 0.9,
        sourceCount: 1,
        chunkCount: 2,
        wikiPageCount: null,
        sourceTitles: ["SPEC.md"],
        sourceVisibilities: ["public_preview"],
        citationReady: true,
        createdAt: new Date("2026-08-13T00:00:00Z"),
        updatedAt: new Date("2026-08-13T00:00:00Z"),
      }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ type: "project", count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    const result = await listKnowledge("owner", { page: 1, pageSize: 20, status: "active", sort: "updated" });

    expect(result.items.map((item) => [item.sourceKind, item.title])).toEqual([
      ["repository_wiki", "Copybook Generator — Repository Wiki"],
      ["knowledge_item", "Askme"],
    ]);
    expect(result.counts).toMatchObject({ all: 2, project: 1, repository: 1 });
    expect(result.total).toBe(2);
    expect(query).toHaveBeenCalledTimes(5);
    expect(String(query.mock.calls[0]?.[0])).toContain("UNION ALL");
    expect(String(query.mock.calls[0]?.[0])).toContain("active_projection_id");
    expect(String(query.mock.calls[0]?.[0])).toContain("projection.state='approved'");
  });

  it("keeps the database LIMIT bounded by page size for a high page number", async () => {
    query.mockResolvedValue({ rows: [] });

    await listKnowledge("owner", { page: 100_000, pageSize: 100, status: "active", sort: "updated" });

    expect(query).toHaveBeenCalledTimes(5);
    expect(String(query.mock.calls[0]?.[0])).toContain("LIMIT $6 OFFSET $7");
    expect(query.mock.calls[0]?.[1]).toEqual(["owner", "active", null, null, null, 100, 9_999_900]);
  });
});
