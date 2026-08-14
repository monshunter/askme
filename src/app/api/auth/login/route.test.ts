import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/service", () => ({
  authenticate: vi.fn(),
  createSession: vi.fn(),
  SESSION_COOKIE: "askme_session",
  sessionCookieOptions: vi.fn(),
}));
vi.mock("@/server/auth/auth-rate-limit", () => ({ consumeAuthRateLimit: vi.fn() }));

import { POST } from "./route";

function request(body: string) {
  return new NextRequest("http://127.0.0.1:3000/api/auth/login", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "x-request-id": "login-input-test" },
  });
}

describe("POST /api/auth/login input", () => {
  it("returns a stable client error for invalid JSON credentials", async () => {
    const response = await POST(request("{}"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_CREDENTIALS_INPUT");
  });

  it("returns a stable client error for malformed JSON", async () => {
    const response = await POST(request("not-json"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_JSON");
  });
});
