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
      },
    });
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
});
