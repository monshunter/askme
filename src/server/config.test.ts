import { describe, expect, it } from "vitest";

import { loadConfigFromSources, parseAllowedEnv } from "./config";

describe("runtime config", () => {
  it("uses process environment before the user env file", () => {
    const config = loadConfigFromSources(
      {
        DATABASE_URL: "postgresql://process-db",
        ASKME_AI_API_KEY: "process-key",
        ASKME_AI_ROUTER_MODEL: "process-router",
        ASKME_AI_RAG_MODEL: "process-rag",
        ASKME_AI_CODE_MODEL: "process-code",
      },
      "DATABASE_URL=postgresql://file-db\nASKME_AI_API_KEY=file-key\nASKME_AI_ROUTER_MODEL=file-router\n",
    );

    expect(config.databaseUrl).toBe("postgresql://process-db");
    expect(config.ai.apiKey).toBe("process-key");
    expect(config.ai.profiles.router.model).toBe("process-router");
    expect(config.ai.profiles.rag.model).toBe("process-rag");
    expect(config.ai.profiles.code.model).toBe("process-code");
  });

  it("loads allowlisted values from an env file and ignores unrelated keys", () => {
    const parsed = parseAllowedEnv(
      "export ASKME_AI_API_KEY='file-key'\nASKME_AI_BASE_URL=\"https://example.test/v1\"\nDEEPSEEK_API_KEY=legacy-must-not-load\nUNRELATED_SECRET=never-load\n",
    );

    expect(parsed).toEqual({
      ASKME_AI_API_KEY: "file-key",
      ASKME_AI_BASE_URL: "https://example.test/v1",
    });
  });

  it("uses the approved independent AI profile defaults without inventing an API key", () => {
    const config = loadConfigFromSources({ DATABASE_URL: "postgresql://db" }, "");

    expect(config.ai).toEqual({
      apiKey: null,
      baseUrl: "https://api.deepseek.com/v1",
      profiles: {
        router: expect.objectContaining({ id: "router", model: "deepseek-v4-flash", thinking: "off" }),
        rag: expect.objectContaining({ id: "rag", model: "deepseek-v4-flash", thinking: "off" }),
        code: expect.objectContaining({ id: "code", model: "deepseek-v4-pro", thinking: "high", contextWindow: 1_000_000, maxTokens: 200_000 }),
        planner: expect.objectContaining({ id: "planner", model: "deepseek-v4-flash", thinking: "off" }),
        verifier: expect.objectContaining({ id: "verifier", model: "deepseek-v4-flash", thinking: "off" }),
      },
    });
    expect(config.embedding).toEqual({
      apiKey: null,
      baseUrl: null,
      model: "qwen3.7-text-embedding",
      dimensions: 1_024,
      timeoutMs: 20_000,
      maxRetries: 1,
      batchSize: 16,
      concurrency: 2,
    });
    expect(config.rerank).toEqual({
      apiKey: null,
      baseUrl: null,
      model: "qwen3-rerank",
      protocol: "dashscope-compatible",
      timeoutMs: 20_000,
      maxRetries: 1,
      topN: 8,
    });
    expect(config.rag).toEqual({
      policyVersion: "hybrid-rag-v2",
      retrieval: {
        exactTopK: 20,
        lexicalTopK: 30,
        vectorTopK: 30,
        structuredTopK: 20,
        exactWeight: 1.5,
        lexicalWeight: 1,
        vectorWeight: 1,
        structuredWeight: 1.2,
        rrfK: 60,
        maxChildrenPerParent: 3,
        maxRounds: 2,
      },
      evidence: { maxTokens: 200_000, outputReserveTokens: 8_000, safetyMarginTokens: 4_000 },
      chunking: { childTargetTokens: 420, childMinTokens: 80, childHardMaxTokens: 650, parentMinTokens: 900, parentMaxTokens: 1_500, overlapTokens: 48 },
      repositoryDocuments: {
        include: ["README*.md", "*.md", "docs/**/*.md", "docs/**/*.pdf"],
        exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/coverage/**"],
        maxMarkdownBytes: 2 * 1024 * 1024,
        maxPdfBytes: 50 * 1024 * 1024,
        maxPdfPages: 500,
        maxRevisionTokens: 5_000_000,
      },
    });
    expect(config.publicBaseUrl).toBe("https://askme.monshunter.xyz/");
    expect(config.mail).toEqual({
      status: "not_configured",
      host: null,
      port: 587,
      secure: false,
      user: null,
      password: null,
      from: null,
    });
    expect(config.codeAgent).toMatchObject({
      image: "askme-code-agent:0.1.0",
      imageDigest: null,
      rootfsPath: null,
      promptVersion: "repository-code-agent-v1",
      cpus: 1,
      memoryMib: 1_024,
      diskSizeGb: 2,
      globalConcurrency: 2,
      dailyQuotas: { global: 1_000, candidate: 50, repository: 10 },
      budgets: {
        repositoryAnalysis: { analysisTimeoutMs: 1_200_000, maxRounds: 50, maxToolCalls: 80 },
        conversationAnalysis: { analysisTimeoutMs: 120_000, maxRounds: 50, maxToolCalls: 80 },
      },
    });
  });

  it("loads Embedding and Rerank providers independently without deriving credentials or endpoints", () => {
    const config = loadConfigFromSources({
      ASKME_EMBEDDING_MODEL_API_KEY: "embedding-secret",
      ASKME_EMBEDDING_MODEL_API_BASE_URL: "https://embedding.example.test/v1/",
      ASKME_EMBEDDING_MODEL: "embedding-model",
      ASKME_EMBEDDING_DIMENSIONS: "1024",
      ASKME_EMBEDDING_BATCH_SIZE: "32",
      ASKME_RERANK_MODEL_API_KEY: "rerank-secret",
      ASKME_RERANK_MODEL_API_BASE_URL: "https://rerank.example.test/compatible-api/v1/",
      ASKME_RERANK_MODEL: "rerank-model",
      ASKME_RERANK_PROVIDER_PROTOCOL: "cohere-compatible",
      ASKME_RERANK_TOP_N: "12",
      ASKME_RAG_EVIDENCE_MAX_TOKENS: "120000",
    }, "");

    expect(config.embedding).toMatchObject({ apiKey: "embedding-secret", baseUrl: "https://embedding.example.test/v1", model: "embedding-model", dimensions: 1_024, batchSize: 32 });
    expect(config.rerank).toMatchObject({ apiKey: "rerank-secret", baseUrl: "https://rerank.example.test/compatible-api/v1", model: "rerank-model", protocol: "cohere-compatible", topN: 12 });
    expect(config.rag.evidence.maxTokens).toBe(120_000);

    const embeddingOnly = loadConfigFromSources({
      ASKME_EMBEDDING_MODEL_API_KEY: "embedding-secret",
      ASKME_EMBEDDING_MODEL_API_BASE_URL: "https://embedding.example.test/v1",
    }, "");
    expect(embeddingOnly.rerank).toMatchObject({ apiKey: null, baseUrl: null });
  });

  it("rejects unsafe provider URLs and retrieval budgets outside the approved bounds", () => {
    expect(() => loadConfigFromSources({ ASKME_EMBEDDING_MODEL_API_BASE_URL: "https://user:secret@example.test/v1" }, "")).toThrow("ASKME_EMBEDDING_MODEL_API_BASE_URL");
    expect(() => loadConfigFromSources({ ASKME_RERANK_MODEL_API_BASE_URL: "file:///tmp/rerank" }, "")).toThrow("ASKME_RERANK_MODEL_API_BASE_URL");
    expect(() => loadConfigFromSources({ ASKME_RERANK_PROVIDER_PROTOCOL: "unknown" }, "")).toThrow("ASKME_RERANK_PROVIDER_PROTOCOL");
    expect(() => loadConfigFromSources({ ASKME_EMBEDDING_DIMENSIONS: "768" }, "")).toThrow("ASKME_EMBEDDING_DIMENSIONS");
    expect(() => loadConfigFromSources({ ASKME_RAG_RETRIEVAL_MAX_ROUNDS: "3" }, "")).toThrow("ASKME_RAG_RETRIEVAL_MAX_ROUNDS");
    expect(() => loadConfigFromSources({ ASKME_RAG_CHILD_HARD_MAX_TOKENS: "79" }, "")).toThrow("ASKME_RAG_CHILD_HARD_MAX_TOKENS");
  });

  it("does not accept obsolete publication or visitor daily Conversation Deep quotas", () => {
    expect(parseAllowedEnv("ASKME_CODE_AGENT_PUBLICATION_DAILY_QUOTA=1\nASKME_CODE_AGENT_VISITOR_DAILY_QUOTA=1\n")).toEqual({});
  });

  it("allows developers to override the shared Code Agent round budget", () => {
    const config = loadConfigFromSources({ ASKME_CODE_AGENT_MAX_ROUNDS: "25" }, "");

    expect(config.codeAgent.budgets.repositoryAnalysis.maxRounds).toBe(25);
    expect(config.codeAgent.budgets.conversationAnalysis.maxRounds).toBe(25);
  });

  it("allows developers to override the Code Agent model input and output windows independently", () => {
    const config = loadConfigFromSources({ ASKME_AI_CODE_CONTEXT_WINDOW: "500000", ASKME_AI_CODE_MAX_TOKENS: "100000" }, "");

    expect(config.ai.profiles.code.contextWindow).toBe(500_000);
    expect(config.ai.profiles.code.maxTokens).toBe(100_000);
  });

  it("rejects invalid numeric profile overrides instead of silently widening budgets", () => {
    expect(() => loadConfigFromSources({ ASKME_AI_ROUTER_TIMEOUT_MS: "0" }, "")).toThrow("ASKME_AI_ROUTER_TIMEOUT_MS");
    expect(() => loadConfigFromSources({ ASKME_AI_RAG_MAX_TOKENS: "not-a-number" }, "")).toThrow("ASKME_AI_RAG_MAX_TOKENS");
    expect(() => loadConfigFromSources({ ASKME_AI_CODE_CONTEXT_WINDOW: "0" }, "")).toThrow("ASKME_AI_CODE_CONTEXT_WINDOW");
    expect(() => loadConfigFromSources({ ASKME_CODE_AGENT_MAX_TOOL_CALLS: "0" }, "")).toThrow("ASKME_CODE_AGENT_MAX_TOOL_CALLS");
    expect(() => loadConfigFromSources({ ASKME_CODE_AGENT_IMAGE_DIGEST: "latest" }, "")).toThrow("ASKME_CODE_AGENT_IMAGE_DIGEST");
    expect(() => loadConfigFromSources({ ASKME_CODE_AGENT_LEASE_MS: "10000", ASKME_CODE_AGENT_HEARTBEAT_MS: "6000" }, "")).toThrow("ASKME_CODE_AGENT_HEARTBEAT_MS");
  });

  it("requires complete SMTP fields while keeping credentials server-only", () => {
    const configured = loadConfigFromSources({
      ASKME_SMTP_HOST: "smtp.example.test",
      ASKME_SMTP_PORT: "465",
      ASKME_SMTP_SECURE: "true",
      ASKME_SMTP_USER: "mailer",
      ASKME_SMTP_PASSWORD: "smtp-secret",
      ASKME_SMTP_FROM: "Askme <noreply@example.test>",
    }, "");
    expect(configured.mail).toEqual({
      status: "configured",
      host: "smtp.example.test",
      port: 465,
      secure: true,
      user: "mailer",
      password: "smtp-secret",
      from: "Askme <noreply@example.test>",
    });

    const invalid = loadConfigFromSources({ ASKME_SMTP_HOST: "smtp.example.test" }, "");
    expect(invalid.mail.status).toBe("invalid_configuration");
  });

  it("normalizes an allowlisted public base URL and rejects unsafe or non-root values", () => {
    expect(parseAllowedEnv("ASKME_PUBLIC_BASE_URL=https://careers.example.test\n")).toEqual({
      ASKME_PUBLIC_BASE_URL: "https://careers.example.test",
    });
    expect(loadConfigFromSources({ ASKME_PUBLIC_BASE_URL: "http://localhost:3000" }, "").publicBaseUrl).toBe("http://localhost:3000/");

    for (const value of [
      "ftp://careers.example.test/",
      "https://user:password@careers.example.test/",
      "https://careers.example.test/app",
      "https://careers.example.test/?tenant=askme",
      "https://careers.example.test/#invite",
    ]) {
      expect(() => loadConfigFromSources({ ASKME_PUBLIC_BASE_URL: value }, "")).toThrow("ASKME_PUBLIC_BASE_URL");
    }
  });
});
