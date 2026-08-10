import { describe, expect, it, vi } from "vitest";

import { ApiClientError, requestApi } from "./api-client";

describe("requestApi", () => {
  it("returns both the response and parsed API envelope", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { total: 3 }, error: null }), { status: 200 }));

    const result = await requestApi<{ data: { total: number }; error: null }>("/api/materials", undefined, fetcher);

    expect(result.response.status).toBe(200);
    expect(result.payload.data.total).toBe(3);
  });

  it("maps a network rejection to a stable client error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("socket details must not reach the UI"));

    await expect(requestApi("/api/materials", undefined, fetcher)).rejects.toEqual(new ApiClientError("network"));
  });

  it("maps an invalid response body to a stable client error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json", { status: 502 }));

    await expect(requestApi("/api/materials", undefined, fetcher)).rejects.toEqual(new ApiClientError("invalid_response"));
  });
});
