import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ getPool: vi.fn() }));

import { getPool } from "@/server/db/client";

import { loadHighlightCuration, parseHighlightSelection, saveFeaturedHighlights } from "./highlight-curation";

const query = vi.fn().mockResolvedValue({ rows: [] });

function mockPool() {
  const client = { query, release: vi.fn() };
  vi.mocked(getPool).mockReturnValue({ connect: vi.fn().mockResolvedValue(client), query } as never);
  return client;
}

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

describe("parseHighlightSelection", () => {
  it("rejects malformed bodies and ids", () => {
    expect(() => parseHighlightSelection(null)).toThrowError(expect.objectContaining({ code: "INVALID_HIGHLIGHTS" }));
    expect(() => parseHighlightSelection({})).toThrowError(expect.objectContaining({ code: "INVALID_HIGHLIGHTS" }));
    expect(() => parseHighlightSelection({ knowledgeItemIds: "not-an-array" })).toThrowError(expect.objectContaining({ code: "INVALID_HIGHLIGHTS" }));
    expect(() => parseHighlightSelection({ knowledgeItemIds: ["not-a-uuid"] })).toThrowError(expect.objectContaining({ code: "INVALID_HIGHLIGHTS" }));
    expect(() => parseHighlightSelection({ knowledgeItemIds: [1] })).toThrowError(expect.objectContaining({ code: "INVALID_HIGHLIGHTS" }));
  });

  it("rejects more than 5 ids and deduplicates", () => {
    const six = Array.from({ length: 6 }, (_, index) => `11111111-1111-4111-8111-11111111111${index}`);
    expect(() => parseHighlightSelection({ knowledgeItemIds: six })).toThrowError(expect.objectContaining({ code: "INVALID_HIGHLIGHTS" }));
    expect(parseHighlightSelection({ knowledgeItemIds: [ITEM_ID, ITEM_ID, OTHER_ID] })).toEqual([ITEM_ID, OTHER_ID]);
    expect(parseHighlightSelection({ knowledgeItemIds: [] })).toEqual([]);
  });
});

describe("loadHighlightCuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPool).mockReturnValue({ query } as never);
  });

  it("selects featured items first with the eligibility flag and pages the candidate pool", async () => {
    query
      .mockResolvedValueOnce({ rows: [{
        id: ITEM_ID, type: "project", title: "Featured", summary: "Selected", highlights: ["a", "b", "c", "d"],
        eligible: true,
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: OTHER_ID, type: "skill", title: "Candidate", summary: "Pool", highlights: ["x", "y"], confidence: 0.7,
      }] })
      .mockResolvedValueOnce({ rows: [{ total: 12 }] });

    const result = await loadHighlightCuration("owner", 1);

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][0]).toContain("featured_at IS NOT NULL");
    expect(query.mock.calls[0][0]).toContain("ORDER BY knowledge.featured_at ASC,knowledge.id ASC LIMIT 5");
    expect(query.mock.calls[1][0]).toContain("featured_at IS NULL");
    expect(query.mock.calls[1][0]).toContain("LIMIT 5 OFFSET $2");
    expect(result.featured).toEqual([{ id: ITEM_ID, type: "project", title: "Featured", summary: "Selected", highlights: ["a", "b", "c"], eligible: true }]);
    expect(result.items).toEqual([{ id: OTHER_ID, type: "skill", title: "Candidate", summary: "Pool", highlights: ["x", "y"], confidence: 0.7 }]);
    expect(result.totalPages).toBe(3);
  });

  it("offsets the pool for later pages", async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // featured
      .mockResolvedValueOnce({ rows: [] }) // pool
      .mockResolvedValueOnce({ rows: [{ total: 12 }] }); // count

    await loadHighlightCuration("owner", 2);

    expect(query.mock.calls[1][1]).toEqual(["owner", 5]);
  });
});

describe("saveFeaturedHighlights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects more than five ids before touching the database", async () => {
    mockPool();
    const six = Array.from({ length: 6 }, (_, index) => `11111111-1111-4111-8111-11111111111${index}`);
    await expect(saveFeaturedHighlights("owner", six)).rejects.toMatchObject({ code: "HIGHLIGHT_LIMIT_EXCEEDED" });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects selections that are not active and publicly eligible", async () => {
    mockPool();
    query.mockResolvedValueOnce({ rows: [] }); // eligibility check: 0 of 2 ids match
    await expect(saveFeaturedHighlights("owner", [ITEM_ID, OTHER_ID])).rejects.toMatchObject({ code: "HIGHLIGHT_NOT_ELIGIBLE" });
    expect(query).toHaveBeenCalledTimes(3); // BEGIN, eligibility, ROLLBACK
  });

  it("replaces the featured set in selection order and audits both sides", async () => {
    mockPool();
    query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: ITEM_ID }] }) // eligibility: the submitted id is valid
      .mockResolvedValueOnce({ rows: [{ id: OTHER_ID }] }) // previously featured
      .mockResolvedValueOnce({ rows: [] }) // clear-all update
      .mockResolvedValueOnce({ rows: [] }) // per-item update ITEM_ID
      .mockResolvedValueOnce({ rows: [] }) // audit featured ITEM_ID
      .mockResolvedValueOnce({ rows: [] }) // audit unfeatured OTHER_ID
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
      .mockResolvedValueOnce({ rows: [{ id: ITEM_ID, type: "project", title: "Featured", summary: "Selected", highlights: ["a"], eligible: true }] }); // reload featured

    const result = await saveFeaturedHighlights("owner", [ITEM_ID], "request-1");

    expect(query.mock.calls[0][0]).toBe("BEGIN");
    expect(query.mock.calls[1][0]).toContain("id=ANY($2::uuid[])");
    expect(query.mock.calls[2][0]).toContain("featured_at IS NOT NULL");
    expect(query.mock.calls[3][0]).toContain("UPDATE knowledge_items SET featured_at=NULL");
    const setCall = query.mock.calls[4];
    expect(setCall[0]).toContain("UPDATE knowledge_items SET featured_at=$3");
    expect(setCall[1]).toEqual([ITEM_ID, "owner", expect.any(Date)]);
    const auditFeatured = query.mock.calls[5];
    expect(auditFeatured[0]).toContain("agent.highlights.save");
    expect(auditFeatured[1]).toEqual(["owner", ITEM_ID, "featured", "request-1", "{}"]);
    const auditUnfeatured = query.mock.calls[6];
    expect(auditUnfeatured[1]).toEqual(["owner", OTHER_ID, "unfeatured", "request-1", "{}"]);
    expect(query.mock.calls[7][0]).toBe("COMMIT");
    expect(result).toEqual({ featured: [{ id: ITEM_ID, type: "project", title: "Featured", summary: "Selected", highlights: ["a"], eligible: true }] });
  });
});
