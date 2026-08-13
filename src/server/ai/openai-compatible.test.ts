import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

import { OpenAiChatClient, type AiProfile } from "./openai-compatible";

const profile: AiProfile = {
  id: "rag",
  model: "deepseek-v4-flash",
  thinking: "off",
  contextWindow: 1_000_000,
  timeoutMs: 2_000,
  maxRetries: 0,
  maxTokens: 1_200,
};

describe("OpenAiChatClient", () => {
  it("fails closed when the generic OpenAI-compatible API key is not configured", async () => {
    const client = new OpenAiChatClient({ apiKey: null, baseUrl: "https://gateway.example.test/v1", profile });

    await expect(client.complete([{ role: "user", content: "hello" }])).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" } satisfies Partial<AppError>);
  });

  it("uses the selected profile through Chat Completions without provider-specific credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "chatcmpl-test", model: "deepseek-v4-flash", choices: [{ message: { content: "grounded answer" }, finish_reason: "stop", index: 0 }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new OpenAiChatClient({ apiKey: "secret", baseUrl: "https://gateway.example.test/v1/", profile }, { fetcher });

    const result = await client.complete([{ role: "user", content: "return JSON" }], { jsonObject: true, maxTokens: 900, temperature: 0.2 });

    expect(result).toEqual({ content: "grounded answer", inputTokens: 10, outputTokens: 4, model: "deepseek-v4-flash" });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://gateway.example.test/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "return JSON" }],
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      max_tokens: 900,
      temperature: 0.2,
      stream: false,
    });
  });

  it("maps upstream authentication failures to a stable safe error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("provider body must not leak", { status: 401 }));
    const client = new OpenAiChatClient({ apiKey: "secret", baseUrl: "https://gateway.example.test/v1", profile }, { fetcher });

    await expect(client.complete([{ role: "user", content: "hello" }])).rejects.toMatchObject({
      code: "AI_AUTH_FAILED",
      message: "The AI provider rejected the configured credentials.",
    } satisfies Partial<AppError>);
  });

  it("enforces a caller-owned hard deadline even when the response body stalls", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      await new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
      throw new Error("unreachable");
    });
    const client = new OpenAiChatClient({ apiKey: "secret", baseUrl: "https://gateway.example.test/v1", profile: { ...profile, timeoutMs: 20 } }, { fetcher });

    await expect(client.complete([{ role: "user", content: "hello" }])).rejects.toMatchObject({ code: "AI_TIMEOUT" } satisfies Partial<AppError>);
  });
});
