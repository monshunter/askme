import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

import { DeepSeekClient } from "./deepseek";

describe("DeepSeekClient", () => {
  it("fails closed when the API key is not configured", async () => {
    const client = new DeepSeekClient({ apiKey: null, baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" });

    await expect(client.complete([{ role: "user", content: "hello" }])).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" } satisfies Partial<AppError>);
  });

  it("calls the approved model through the OpenAI-compatible endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "grounded answer" } }], usage: { prompt_tokens: 10, completion_tokens: 4 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new DeepSeekClient(
      { apiKey: "secret", baseUrl: "https://api.deepseek.com/", model: "deepseek-v4-flash" },
      { fetcher, timeoutMs: 2_000 },
    );

    const result = await client.complete([{ role: "user", content: "return JSON" }], { jsonObject: true, maxTokens: 2_000, temperature: 0.2 });

    expect(result).toEqual({ content: "grounded answer", inputTokens: 10, outputTokens: 4 });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      max_tokens: 2_000,
      temperature: 0.2,
    });
  });

  it("maps authentication failures to a stable safe error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("upstream body must not leak", { status: 401 }));
    const client = new DeepSeekClient(
      { apiKey: "secret", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
      { fetcher },
    );

    await expect(client.complete([{ role: "user", content: "hello" }])).rejects.toMatchObject({
      code: "AI_AUTH_FAILED",
      message: "The AI provider rejected the configured credentials.",
    } satisfies Partial<AppError>);
  });
});
