import { beforeEach, describe, expect, it, vi } from "vitest";

const { connect, query, release } = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getPool: () => ({ connect }) }));

import { resetPreviewConversations } from "./preview-service";

describe("Candidate preview conversation reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connect.mockResolvedValue({ query, release });
  });

  it("locks and replaces only the authenticated owner's preview conversations", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "conversation-old" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "conversation-old" }] })
      .mockResolvedValueOnce({ rows: [{ id: "conversation-new" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(resetPreviewConversations("candidate-1", "request-1")).resolves.toEqual({ conversationId: "conversation-new", resetCount: 1 });

    const lockSql = String(query.mock.calls[2]?.[0]);
    expect(lockSql).toContain("owner_id=$1 AND mode='preview'");
    expect(lockSql).toContain("FOR UPDATE");
    expect(query.mock.calls[2]?.[1]).toEqual(["candidate-1"]);

    const deleteSql = String(query.mock.calls[5]?.[0]);
    expect(deleteSql).toContain("DELETE FROM conversations");
    expect(deleteSql).toContain("owner_id=$1 AND mode='preview'");
    expect(query.mock.calls[5]?.[1]).toEqual(["candidate-1"]);
    expect(String(query.mock.calls[7]?.[0])).toContain("agent.preview.reset");
    expect(query).toHaveBeenLastCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("refuses reset while an owned preview analysis is active", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "conversation-old" }] })
      .mockResolvedValueOnce({ rows: [{ id: "run-active" }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(resetPreviewConversations("candidate-1", "request-2")).rejects.toMatchObject({ code: "PREVIEW_SESSION_BUSY", status: 409 });
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("DELETE FROM conversations"), expect.anything());
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("refuses reset while an owned preview answer is pending", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "conversation-old" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "answer-pending" }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(resetPreviewConversations("candidate-1", "request-3")).rejects.toMatchObject({ code: "PREVIEW_SESSION_BUSY", status: 409 });
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("DELETE FROM conversations"), expect.anything());
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
  });
});
