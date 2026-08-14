import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const { resetCandidatePassword } = vi.hoisted(() => ({ resetCandidatePassword: vi.fn().mockResolvedValue({ reset: true }) }));
vi.mock("@/server/auth/candidate-service", () => ({ resetCandidatePassword }));
vi.mock("@/server/auth/auth-rate-limit", () => ({ consumeAuthRateLimit: vi.fn() }));

import { POST } from "./route";

describe("POST /api/auth/reset-password", () => {
  it("rejects mismatched confirmation before consuming a reset token", async () => {
    const response = await POST(new NextRequest("http://127.0.0.1:3000/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "a".repeat(43), password: "Replacement-pass-2026!", confirmPassword: "Different-pass-2026!" }),
    }));
    expect(response.status).toBe(400);
    expect(resetCandidatePassword).not.toHaveBeenCalled();
  });
});
