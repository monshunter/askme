import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const { requestCandidatePasswordReset } = vi.hoisted(() => ({ requestCandidatePasswordReset: vi.fn().mockResolvedValue({ accepted: true }) }));
vi.mock("@/server/auth/candidate-service", () => ({ requestCandidatePasswordReset }));
vi.mock("@/server/auth/auth-rate-limit", () => ({ consumeAuthRateLimit: vi.fn() }));

import { POST } from "./route";

describe("POST /api/auth/forgot-password", () => {
  it("returns the same accepted projection owned by the service", async () => {
    const response = await POST(new NextRequest("http://127.0.0.1:3000/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: " Candidate@Example.com " }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { accepted: true }, error: null });
    expect(requestCandidatePasswordReset).toHaveBeenCalledWith({ email: "candidate@example.com" }, "http://localhost:3000", expect.any(String));
  });
});
