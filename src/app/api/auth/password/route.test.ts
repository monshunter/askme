import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const { changeCandidatePassword } = vi.hoisted(() => ({ changeCandidatePassword: vi.fn().mockResolvedValue({ changed: true }) }));
vi.mock("@/server/auth/candidate-service", () => ({ changeCandidatePassword }));
vi.mock("@/server/auth/auth-rate-limit", () => ({ consumeAuthRateLimit: vi.fn() }));
vi.mock("@/server/auth/current", () => ({ requireRequestUser: vi.fn().mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", email: "candidate@example.com", role: "candidate", locale: "en", displayName: "Candidate", headline: null, location: null, bio: null, avatarUrl: null }) }));
vi.mock("@/server/auth/service", () => ({ createSession: vi.fn().mockResolvedValue({ token: "new-session", expiresAt: new Date("2026-08-15T00:00:00Z") }), SESSION_COOKIE: "askme_session", sessionCookieOptions: vi.fn().mockReturnValue({ httpOnly: true, path: "/" }) }));

import { POST } from "./route";

describe("POST /api/auth/password", () => {
  it("changes a Candidate password and returns a replacement session", async () => {
    const response = await POST(new NextRequest("http://127.0.0.1:3000/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "Candidate-pass-2026!", newPassword: "Replacement-pass-2026!", confirmPassword: "Replacement-pass-2026!" }),
    }));
    expect(response.status).toBe(200);
    expect(changeCandidatePassword).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", { currentPassword: "Candidate-pass-2026!", newPassword: "Replacement-pass-2026!" }, expect.any(String));
    expect(response.headers.get("set-cookie")).toContain("askme_session=new-session");
  });
});
