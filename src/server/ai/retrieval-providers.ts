import { z } from "zod";

import type { RuntimeConfig } from "@/server/config";
import { AppError } from "@/server/errors";

type ProviderOptions = { fetcher?: typeof fetch };

const embeddingResponseSchema = z.object({
  data: z.array(z.object({ index: z.number().int().min(0), embedding: z.array(z.number().finite()) }).passthrough()),
  usage: z.object({ prompt_tokens: z.number().int().min(0).optional(), total_tokens: z.number().int().min(0).optional() }).optional(),
}).passthrough();

const compatibleRerankResponseSchema = z.object({
  results: z.array(z.object({ index: z.number().int().min(0), relevance_score: z.number().finite() }).passthrough()),
  usage: z.object({ total_tokens: z.number().int().min(0).optional(), prompt_tokens: z.number().int().min(0).optional() }).optional(),
}).passthrough();

const DASH_SCOPE_RERANK_INSTRUCT = "Given a web search query, retrieve relevant passages that answer the query.";

function stableProviderError(kind: "EMBEDDING" | "RERANK", status: number | null, timedOut: boolean) {
  if (timedOut) return new AppError(`${kind}_TIMEOUT`, `The ${kind.toLowerCase()} provider did not respond in time.`, 504);
  if (status === 401 || status === 403) return new AppError(`${kind}_AUTH_FAILED`, `The ${kind.toLowerCase()} provider rejected the configured credentials.`, 502);
  if (status === 429) return new AppError(`${kind}_RATE_LIMITED`, `The ${kind.toLowerCase()} provider is temporarily rate limited.`, 503);
  if (status !== null) return new AppError(`${kind}_UPSTREAM_FAILED`, `The ${kind.toLowerCase()} provider returned an error.`, 502, { upstreamStatus: status });
  return new AppError(`${kind}_UNAVAILABLE`, `The ${kind.toLowerCase()} provider is unavailable.`, 503);
}

async function postJson(input: {
  kind: "EMBEDDING" | "RERANK";
  url: string;
  apiKey: string;
  body: unknown;
  timeoutMs: number;
  maxRetries: number;
  fetcher: typeof fetch;
}) {
  for (let attempt = 0; attempt <= input.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await input.fetcher(input.url, {
        method: "POST",
        headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(input.body),
        signal: controller.signal,
      });
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < input.maxRetries) continue;
        throw stableProviderError(input.kind, response.status, false);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (attempt < input.maxRetries) continue;
      throw stableProviderError(input.kind, null, controller.signal.aborted);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw stableProviderError(input.kind, null, false);
}

export class EmbeddingClient {
  private readonly fetcher: typeof fetch;

  constructor(private readonly config: RuntimeConfig["embedding"], options: ProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async embed(input: string[]) {
    if (!this.config.apiKey || !this.config.baseUrl) {
      throw new AppError("EMBEDDING_NOT_CONFIGURED", "The embedding provider is not configured.", 503);
    }
    if (input.length === 0 || input.length > this.config.batchSize || input.some((value) => !value.trim())) {
      throw new AppError("EMBEDDING_INPUT_INVALID", "The embedding input is invalid.", 400);
    }
    const body = await postJson({
      kind: "EMBEDDING",
      url: `${this.config.baseUrl}/embeddings`,
      apiKey: this.config.apiKey,
      body: { model: this.config.model, input, dimensions: this.config.dimensions, encoding_format: "float" },
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries,
      fetcher: this.fetcher,
    });
    const parsed = embeddingResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.data.length !== input.length) {
      throw new AppError("EMBEDDING_INVALID_RESPONSE", "The embedding provider returned invalid vectors.", 502);
    }
    const ordered = [...parsed.data.data].sort((left, right) => left.index - right.index);
    if (ordered.some((item, index) => item.index !== index || item.embedding.length !== this.config.dimensions)) {
      throw new AppError("EMBEDDING_INVALID_RESPONSE", "The embedding provider returned invalid vectors.", 502);
    }
    return {
      vectors: ordered.map((item) => item.embedding),
      inputTokens: parsed.data.usage?.prompt_tokens ?? parsed.data.usage?.total_tokens ?? null,
    };
  }
}

export class RerankClient {
  private readonly fetcher: typeof fetch;

  constructor(private readonly config: RuntimeConfig["rerank"], options: ProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async rerank(query: string, documents: string[]) {
    if (!this.config.apiKey || !this.config.baseUrl) {
      throw new AppError("RERANK_NOT_CONFIGURED", "The rerank provider is not configured.", 503);
    }
    if (!query.trim() || documents.length === 0 || documents.length > 500 || documents.some((value) => !value.trim())) {
      throw new AppError("RERANK_INPUT_INVALID", "The rerank input is invalid.", 400);
    }
    const topN = Math.min(this.config.topN, documents.length);
    const dashscope = this.config.protocol === "dashscope-compatible";
    const body = await postJson({
      kind: "RERANK",
      url: `${this.config.baseUrl}/reranks`,
      apiKey: this.config.apiKey,
      body: dashscope
        ? { model: this.config.model, query, documents, top_n: topN, instruct: DASH_SCOPE_RERANK_INSTRUCT }
        : { model: this.config.model, query, documents, top_n: topN },
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries,
      fetcher: this.fetcher,
    });
    const parsed = compatibleRerankResponseSchema.safeParse(body);
    const results = parsed.success ? parsed.data.results : [];
    const inputTokens = parsed.success ? parsed.data.usage?.total_tokens ?? parsed.data.usage?.prompt_tokens ?? null : null;
    const rankings = results.map((item) => ({ index: item.index, score: item.relevance_score }));
    const indices = new Set(rankings.map((item) => item.index));
    if (rankings.length === 0 || rankings.length > topN || indices.size !== rankings.length || rankings.some((item) => item.index >= documents.length)) {
      throw new AppError("RERANK_INVALID_RESPONSE", "The rerank provider returned invalid rankings.", 502);
    }
    return {
      rankings,
      inputTokens,
    };
  }
}
