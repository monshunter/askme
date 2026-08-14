import { beforeEach, describe, expect, it, vi } from "vitest";

const { connect, query, release } = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getPool: () => ({ connect }) }));

import { updateCandidateProfile } from "./candidate-service";

describe("Candidate public profile service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connect.mockResolvedValue({ query, release });
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "candidate-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
  });

  it("updates and audits only the authenticated active Candidate", async () => {
    await expect(updateCandidateProfile("candidate-1", {
      displayName: "Riley Chen",
      headline: "AI Agent Engineer",
      location: null,
      bio: "Builds career agents.",
    }, "request-1")).resolves.toEqual({ updated: true });

    expect(query.mock.calls[1]?.[0]).toContain("WHERE id=$1 AND role='candidate' AND status='active'");
    expect(query.mock.calls[1]?.[1]).toEqual(["candidate-1", "Riley Chen", "AI Agent Engineer", null, "Builds career agents."]);
    expect(query.mock.calls[2]?.[0]).toContain("candidate.profile.update");
    expect(query.mock.calls[2]?.[1]?.[0]).toBe("candidate-1");
    expect(query).toHaveBeenLastCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });
});
