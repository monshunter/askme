import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

import { apiData, apiFailure, requestId } from "./http";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("request observability", () => {
  it("preserves only bounded safe upstream request ids", () => {
    expect(requestId(new Request("http://askme.local", { headers: { "x-request-id": "edge_42:attempt-1" } }))).toBe("edge_42:attempt-1");

    const generated = requestId(new Request("http://askme.local", { headers: { "x-request-id": "private value with spaces" } }));
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns the same request id in response headers and JSON envelopes", async () => {
    const response = apiData({ ok: true }, "request-123");

    expect(response.headers.get("x-request-id")).toBe("request-123");
    expect(await response.json()).toEqual({ data: { ok: true }, error: null, requestId: "request-123" });
  });

  it("logs a 5xx field allowlist without private error content", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = apiFailure(new Error("ASKME_PRIVATE_TEXT must not be logged"), "request-500");

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("request-500");
    expect(await response.json()).toEqual({
      data: null,
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", details: null },
      requestId: "request-500",
    });
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      event: "api.request.failed",
      requestId: "request-500",
      code: "INTERNAL_ERROR",
      status: 500,
      causeType: "Error",
    });
    expect(String(log.mock.calls[0]?.[0])).not.toContain("ASKME_PRIVATE_TEXT");
  });

  it("does not emit server error logs for expected client failures", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = apiFailure(new AppError("INVALID_INPUT", "Choose a valid value.", 400), "request-400");

    expect(response.status).toBe(400);
    expect(log).not.toHaveBeenCalled();
  });
});
