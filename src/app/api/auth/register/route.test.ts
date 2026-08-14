import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const { registerCandidate } = vi.hoisted(() => ({ registerCandidate: vi.fn() }));
vi.mock("@/server/auth/candidate-service", () => ({ registerCandidate }));
vi.mock("@/server/auth/auth-rate-limit", () => ({ consumeAuthRateLimit: vi.fn() }));
vi.mock("@/server/auth/service", () => ({
  createSession: vi.fn().mockResolvedValue({ token: "session-token", expiresAt: new Date("2026-08-15T00:00:00Z") }),
  SESSION_COOKIE: "askme_session",
  sessionCookieOptions: vi.fn().mockReturnValue({ httpOnly: true, path: "/" }),
}));

import { POST } from "./route";

describe("POST /api/auth/register", () => {
  it("creates only a normalized Candidate even when a role is submitted", async () => {
    registerCandidate.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", email: "riley@example.com", role: "candidate", locale: "en", displayName: "Riley", headline: null, location: null, bio: null, avatarUrl: null });
    const response = await POST(new NextRequest("http://127.0.0.1:3000/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: " Riley@Example.com ", displayName: " Riley ", password: "Candidate-pass-2026!", confirmPassword: "Candidate-pass-2026!", role: "admin" }),
    }));
    expect(response.status).toBe(201);
    expect(registerCandidate).toHaveBeenCalledWith({ email: "riley@example.com", displayName: "Riley", password: "Candidate-pass-2026!" }, expect.any(String));
    expect((await response.json()).data.user.role).toBe("candidate");
  });
});
