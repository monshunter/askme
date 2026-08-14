import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateCandidateProfile, requireRequestUser } = vi.hoisted(() => ({
  updateCandidateProfile: vi.fn().mockResolvedValue({ updated: true }),
  requireRequestUser: vi.fn().mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    email: "candidate@example.com",
    role: "candidate",
    locale: "en",
    displayName: "Candidate",
    headline: null,
    location: null,
    bio: null,
    avatarUrl: null,
  }),
}));

vi.mock("@/server/auth/candidate-service", () => ({ updateCandidateProfile }));
vi.mock("@/server/auth/current", () => ({ requireRequestUser }));

import { POST } from "./route";

describe("POST /api/auth/profile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates only the authenticated Candidate with normalized public fields", async () => {
    const response = await POST(new NextRequest("http://127.0.0.1:3000/api/auth/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "  Riley Chen  ",
        headline: "  AI Agent Engineer  ",
        location: "  Shanghai  ",
        bio: "  Builds career agents.  ",
        ownerId: "another-user",
        role: "admin",
      }),
    }));
    expect(response.status).toBe(200);
    expect(updateCandidateProfile).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", {
      displayName: "Riley Chen",
      headline: "AI Agent Engineer",
      location: "Shanghai",
      bio: "Builds career agents.",
    }, expect.any(String));
  });

  it("returns a form submission to the Agent page after profile completion", async () => {
    const body = new URLSearchParams({
      displayName: "Riley Chen",
      headline: "AI Agent Engineer",
      location: "",
      bio: "",
      returnTo: "/workspace/agent",
    });
    const response = await POST(new NextRequest("http://127.0.0.1:3000/api/auth/profile", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/workspace/agent");
  });

  it("rejects unsafe return targets and keeps invalid form input at the profile editor", async () => {
    const body = new URLSearchParams({ displayName: "Riley", headline: "", returnTo: "https://attacker.example/" });
    const response = await POST(new NextRequest("http://127.0.0.1:3000/api/auth/profile", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/workspace/account?profileError=invalid#public-profile");
    expect(updateCandidateProfile).not.toHaveBeenCalled();
  });
});
