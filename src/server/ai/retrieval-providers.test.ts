import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

import { EmbeddingClient, RerankClient } from "./retrieval-providers";

describe("EmbeddingClient", () => {
  it("fails closed when its independent provider is not configured", async () => {
    const client = new EmbeddingClient({ apiKey: null, baseUrl: null, model: "qwen3.7-text-embedding", dimensions: 1_024, timeoutMs: 2_000, maxRetries: 0, batchSize: 16, concurrency: 2 });

    await expect(client.embed(["hello"])).rejects.toMatchObject({ code: "EMBEDDING_NOT_CONFIGURED" } satisfies Partial<AppError>);
  });

  it("uses the OpenAI-compatible embeddings contract and validates every vector dimension", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      object: "list",
      data: [
        { object: "embedding", index: 0, embedding: Array.from({ length: 1_024 }, (_, index) => index / 1_024) },
        { object: "embedding", index: 1, embedding: Array.from({ length: 1_024 }, (_, index) => (index + 1) / 1_024) },
      ],
      usage: { prompt_tokens: 8, total_tokens: 8 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new EmbeddingClient({ apiKey: "secret", baseUrl: "https://embedding.example.test/v1", model: "embedding-model", dimensions: 1_024, timeoutMs: 2_000, maxRetries: 0, batchSize: 16, concurrency: 2 }, { fetcher });

    const result = await client.embed(["first", "second"]);

    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]).toHaveLength(1_024);
    expect(result.inputTokens).toBe(8);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://embedding.example.test/v1/embeddings");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
    expect(JSON.parse(String(init?.body))).toEqual({ model: "embedding-model", input: ["first", "second"], dimensions: 1_024, encoding_format: "float" });
  });

  it("rejects malformed vectors instead of mixing dimensions", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2] }] }), { status: 200 }));
    const client = new EmbeddingClient({ apiKey: "secret", baseUrl: "https://embedding.example.test/v1", model: "embedding-model", dimensions: 1_024, timeoutMs: 2_000, maxRetries: 0, batchSize: 16, concurrency: 2 }, { fetcher });

    await expect(client.embed(["hello"])).rejects.toMatchObject({ code: "EMBEDDING_INVALID_RESPONSE" } satisfies Partial<AppError>);
  });
});

describe("RerankClient", () => {
  it("does not reuse Embedding configuration when Rerank is absent", async () => {
    const client = new RerankClient({ apiKey: null, baseUrl: null, model: "qwen3-rerank", protocol: "dashscope-compatible", timeoutMs: 2_000, maxRetries: 0, topN: 8 });

    await expect(client.rerank("query", ["document"])).rejects.toMatchObject({ code: "RERANK_NOT_CONFIGURED" } satisfies Partial<AppError>);
  });

  it("uses the configured compatible endpoint and preserves provider document indices", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: "rerank-test",
      results: [
        { index: 1, relevance_score: 0.92 },
        { index: 0, relevance_score: 0.71 },
      ],
      usage: { total_tokens: 12 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new RerankClient({ apiKey: "rerank-secret", baseUrl: "https://workspace.example.test/compatible-api/v1", model: "qwen3-rerank", protocol: "cohere-compatible", timeoutMs: 2_000, maxRetries: 0, topN: 8 }, { fetcher });

    const result = await client.rerank("query", ["first", "second"]);

    expect(result).toEqual({ rankings: [{ index: 1, score: 0.92 }, { index: 0, score: 0.71 }], inputTokens: 12 });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://workspace.example.test/compatible-api/v1/reranks");
    expect(JSON.parse(String(init?.body))).toEqual({ model: "qwen3-rerank", query: "query", documents: ["first", "second"], top_n: 2 });
  });

  it("uses the DashScope compatible endpoint, response, and question-answer instruct", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      results: [
        { index: 1, relevance_score: 0.96 },
        { index: 0, relevance_score: 0.63 },
      ],
      usage: { total_tokens: 18 },
      id: "dashscope-rerank-test",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new RerankClient({
      apiKey: "rerank-secret",
      baseUrl: "https://workspace-id.cn-beijing.maas.aliyuncs.com/compatible-api/v1",
      model: "qwen3-rerank",
      protocol: "dashscope-compatible",
      timeoutMs: 2_000,
      maxRetries: 0,
      topN: 8,
    }, { fetcher });

    const result = await client.rerank("query", ["first", "second"]);

    expect(result).toEqual({ rankings: [{ index: 1, score: 0.96 }, { index: 0, score: 0.63 }], inputTokens: 18 });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://workspace-id.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "qwen3-rerank",
      query: "query",
      documents: ["first", "second"],
      top_n: 2,
      instruct: "Given a web search query, retrieve relevant passages that answer the query.",
    });
  });

  it("rejects duplicate or out-of-range result indices", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ results: [{ index: 1, relevance_score: 0.9 }, { index: 1, relevance_score: 0.8 }] }), { status: 200 }));
    const client = new RerankClient({ apiKey: "secret", baseUrl: "https://rerank.example.test/v1", model: "qwen3-rerank", protocol: "cohere-compatible", timeoutMs: 2_000, maxRetries: 0, topN: 8 }, { fetcher });

    await expect(client.rerank("query", ["first", "second"])).rejects.toMatchObject({ code: "RERANK_INVALID_RESPONSE" } satisfies Partial<AppError>);
  });
});
