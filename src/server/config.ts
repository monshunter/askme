import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ALLOWED_KEYS = new Set([
  "DATABASE_URL",
  "UPLOAD_ROOT",
  "ASKME_REPOSITORY_ARTIFACT_ROOT",
  "ASKME_AI_API_KEY",
  "ASKME_AI_BASE_URL",
  "ASKME_AI_ROUTER_MODEL",
  "ASKME_AI_ROUTER_THINKING",
  "ASKME_AI_ROUTER_TIMEOUT_MS",
  "ASKME_AI_ROUTER_MAX_RETRIES",
  "ASKME_AI_ROUTER_MAX_TOKENS",
  "ASKME_AI_ROUTER_CONTEXT_WINDOW",
  "ASKME_AI_RAG_MODEL",
  "ASKME_AI_RAG_THINKING",
  "ASKME_AI_RAG_TIMEOUT_MS",
  "ASKME_AI_RAG_MAX_RETRIES",
  "ASKME_AI_RAG_MAX_TOKENS",
  "ASKME_AI_RAG_CONTEXT_WINDOW",
  "ASKME_AI_CODE_MODEL",
  "ASKME_AI_CODE_THINKING",
  "ASKME_AI_CODE_TIMEOUT_MS",
  "ASKME_AI_CODE_MAX_RETRIES",
  "ASKME_AI_CODE_MAX_TOKENS",
  "ASKME_AI_CODE_CONTEXT_WINDOW",
  "ASKME_CODE_AGENT_IMAGE",
  "ASKME_CODE_AGENT_IMAGE_DIGEST",
  "ASKME_CODE_AGENT_ROOTFS_PATH",
  "ASKME_CODE_AGENT_RUNTIME_ROOT",
  "ASKME_CODE_AGENT_PROMPT_VERSION",
  "ASKME_CODE_AGENT_CREATE_TIMEOUT_MS",
  "ASKME_CODE_AGENT_ANALYSIS_TIMEOUT_MS",
  "ASKME_CODE_AGENT_REPOSITORY_ANALYSIS_TIMEOUT_MS",
  "ASKME_CODE_AGENT_CLEANUP_TIMEOUT_MS",
  "ASKME_CODE_AGENT_MAX_ROUNDS",
  "ASKME_CODE_AGENT_MAX_TOOL_CALLS",
  "ASKME_CODE_AGENT_MAX_TOOL_OUTPUT_BYTES",
  "ASKME_CODE_AGENT_MAX_READ_BYTES",
  "ASKME_CODE_AGENT_MAX_READ_LINES",
  "ASKME_CODE_AGENT_MAX_SEARCH_HITS",
  "ASKME_CODE_AGENT_CPUS",
  "ASKME_CODE_AGENT_MEMORY_MIB",
  "ASKME_CODE_AGENT_DISK_GIB",
  "ASKME_CODE_AGENT_GLOBAL_CONCURRENCY",
  "ASKME_CODE_AGENT_LEASE_MS",
  "ASKME_CODE_AGENT_HEARTBEAT_MS",
  "ASKME_CODE_AGENT_POLL_MS",
  "ASKME_CODE_AGENT_GLOBAL_DAILY_QUOTA",
  "ASKME_CODE_AGENT_CANDIDATE_DAILY_QUOTA",
  "ASKME_CODE_AGENT_REPOSITORY_DAILY_QUOTA",
  "ASKME_CANDIDATE_EMAIL",
  "ASKME_CANDIDATE_PASSWORD",
  "ASKME_ADMIN_EMAIL",
  "ASKME_ADMIN_PASSWORD",
  "ASKME_PUBLIC_BASE_URL",
  "ASKME_SMTP_HOST",
  "ASKME_SMTP_PORT",
  "ASKME_SMTP_SECURE",
  "ASKME_SMTP_USER",
  "ASKME_SMTP_PASSWORD",
  "ASKME_SMTP_FROM",
]);

type EnvSource = Record<string, string | undefined>;

export type AiProfile = {
  id: "router" | "rag" | "code";
  model: string;
  thinking: "off" | "low" | "medium" | "high";
  contextWindow: number;
  timeoutMs: number;
  maxRetries: number;
  maxTokens: number;
};

export type CodeAgentBudget = {
  analysisTimeoutMs: number;
  maxRounds: number;
  maxToolCalls: number;
  maxAggregateToolOutputBytes: number;
  maxReadBytes: number;
  maxReadLines: number;
  maxSearchHits: number;
};

export type RuntimeConfig = {
  databaseUrl: string | null;
  uploadRoot: string;
  repositoryArtifactRoot: string;
  publicBaseUrl: string;
  ai: {
    apiKey: string | null;
    baseUrl: string;
    profiles: {
      router: AiProfile;
      rag: AiProfile;
      code: AiProfile;
    };
  };
  codeAgent: {
    image: string;
    imageDigest: string | null;
    rootfsPath: string | null;
    runtimeRoot: string;
    promptVersion: string;
    createTimeoutMs: number;
    cleanupTimeoutMs: number;
    cpus: number;
    memoryMib: number;
    diskSizeGb: number;
    globalConcurrency: number;
    leaseMs: number;
    heartbeatMs: number;
    pollMs: number;
    dailyQuotas: {
      global: number;
      candidate: number;
      repository: number;
    };
    budgets: {
      repositoryAnalysis: CodeAgentBudget;
      conversationAnalysis: CodeAgentBudget;
    };
  };
  bootstrap: {
    candidateEmail: string | null;
    candidatePassword: string | null;
    adminEmail: string | null;
    adminPassword: string | null;
  };
  mail: {
    status: "not_configured" | "invalid_configuration" | "configured";
    host: string | null;
    port: number;
    secure: boolean;
    user: string | null;
    password: string | null;
    from: string | null;
  };
};

function unquote(value: string) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseAllowedEnv(source: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (key && value !== undefined && ALLOWED_KEYS.has(key)) {
      result[key] = unquote(value);
    }
  }

  return result;
}

export function loadConfigFromSources(processEnv: EnvSource, userEnvFile: string): RuntimeConfig {
  const fileEnv = parseAllowedEnv(userEnvFile);
  const read = (key: string) => processEnv[key]?.trim() || fileEnv[key]?.trim() || null;
  const mailHost = read("ASKME_SMTP_HOST");
  const mailPortSource = read("ASKME_SMTP_PORT");
  const mailSecureSource = read("ASKME_SMTP_SECURE");
  const mailUser = read("ASKME_SMTP_USER");
  const mailPassword = read("ASKME_SMTP_PASSWORD");
  const mailFrom = read("ASKME_SMTP_FROM");
  const mailPort = mailPortSource === null ? 587 : Number(mailPortSource);
  const secureValid = mailSecureSource === null || mailSecureSource === "true" || mailSecureSource === "false";
  const mailSecure = mailSecureSource === "true";
  const mailProvided = [mailHost, mailUser, mailPassword, mailFrom].some((value) => value !== null);
  const mailValid = Boolean(mailHost && mailFrom)
    && Number.isInteger(mailPort) && mailPort >= 1 && mailPort <= 65_535
    && secureValid && Boolean(mailUser) === Boolean(mailPassword);
  const publicBaseUrlSource = read("ASKME_PUBLIC_BASE_URL") ?? "https://askme.monshunter.xyz/";
  let publicBaseUrl: string;
  try {
    const parsed = new URL(publicBaseUrlSource);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:")
      || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
      throw new Error("invalid public base URL");
    }
    publicBaseUrl = parsed.toString();
  } catch {
    throw new Error("ASKME_PUBLIC_BASE_URL must be an absolute HTTP(S) root URL without credentials, query, or fragment");
  }
  const integer = (key: string, fallback: number, minimum: number, maximum: number) => {
    const raw = read(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
  };
  const thinking = (key: string, fallback: AiProfile["thinking"]) => {
    const value = read(key) ?? fallback;
    if (value !== "off" && value !== "low" && value !== "medium" && value !== "high") {
      throw new Error(`${key} must be one of off, low, medium, high`);
    }
    return value;
  };
  const profile = (
    id: AiProfile["id"],
    modelKey: string,
    defaultModel: string,
    defaultThinking: AiProfile["thinking"],
    defaultTimeoutMs: number,
    defaultMaxTokens: number,
    defaultContextWindow: number,
  ): AiProfile => ({
    id,
    model: read(modelKey) ?? defaultModel,
    thinking: thinking(`ASKME_AI_${id.toUpperCase()}_THINKING`, defaultThinking),
    timeoutMs: integer(`ASKME_AI_${id.toUpperCase()}_TIMEOUT_MS`, defaultTimeoutMs, 1_000, 600_000),
    maxRetries: integer(`ASKME_AI_${id.toUpperCase()}_MAX_RETRIES`, 1, 0, 3),
    maxTokens: integer(`ASKME_AI_${id.toUpperCase()}_MAX_TOKENS`, defaultMaxTokens, 1, 1_000_000),
    contextWindow: integer(`ASKME_AI_${id.toUpperCase()}_CONTEXT_WINDOW`, defaultContextWindow, 1, 2_000_000),
  });
  const maxRounds = integer("ASKME_CODE_AGENT_MAX_ROUNDS", 50, 1, 100);
  const maxToolCalls = integer("ASKME_CODE_AGENT_MAX_TOOL_CALLS", 80, 1, 1_000);
  const maxAggregateToolOutputBytes = integer("ASKME_CODE_AGENT_MAX_TOOL_OUTPUT_BYTES", 1024 * 1024, 1_024, 16 * 1024 * 1024);
  const maxReadBytes = integer("ASKME_CODE_AGENT_MAX_READ_BYTES", 64 * 1024, 1_024, 1024 * 1024);
  const maxReadLines = integer("ASKME_CODE_AGENT_MAX_READ_LINES", 500, 1, 10_000);
  const maxSearchHits = integer("ASKME_CODE_AGENT_MAX_SEARCH_HITS", 200, 1, 10_000);
  const baseBudget = { maxRounds, maxToolCalls, maxAggregateToolOutputBytes, maxReadBytes, maxReadLines, maxSearchHits };
  const imageDigest = read("ASKME_CODE_AGENT_IMAGE_DIGEST");
  if (imageDigest !== null && !/^sha256:[0-9a-f]{64}$/.test(imageDigest)) {
    throw new Error("ASKME_CODE_AGENT_IMAGE_DIGEST must be a sha256 digest");
  }
  const configuredRootfsPath = read("ASKME_CODE_AGENT_ROOTFS_PATH");
  const codeAgentLeaseMs = integer("ASKME_CODE_AGENT_LEASE_MS", 60_000, 10_000, 600_000);
  const codeAgentHeartbeatMs = integer("ASKME_CODE_AGENT_HEARTBEAT_MS", 20_000, 1_000, 300_000);
  if (codeAgentHeartbeatMs * 2 > codeAgentLeaseMs) {
    throw new Error("ASKME_CODE_AGENT_HEARTBEAT_MS must not exceed half of ASKME_CODE_AGENT_LEASE_MS");
  }

  return {
    databaseUrl: read("DATABASE_URL"),
    uploadRoot: read("UPLOAD_ROOT") ?? path.resolve(process.cwd(), "data/uploads"),
    repositoryArtifactRoot: read("ASKME_REPOSITORY_ARTIFACT_ROOT") ?? path.resolve(process.cwd(), "data/repository-artifacts"),
    publicBaseUrl,
    ai: {
      apiKey: read("ASKME_AI_API_KEY"),
      baseUrl: read("ASKME_AI_BASE_URL") ?? "https://api.deepseek.com/v1",
      profiles: {
        router: profile("router", "ASKME_AI_ROUTER_MODEL", "deepseek-v4-flash", "off", 15_000, 800, 1_000_000),
        rag: profile("rag", "ASKME_AI_RAG_MODEL", "deepseek-v4-flash", "off", 45_000, 4_000, 1_000_000),
        code: profile("code", "ASKME_AI_CODE_MODEL", "deepseek-v4-pro", "high", 120_000, 200_000, 1_000_000),
      },
    },
    codeAgent: {
      image: read("ASKME_CODE_AGENT_IMAGE") ?? "askme-code-agent:0.1.0",
      imageDigest,
      rootfsPath: configuredRootfsPath ? path.resolve(/* turbopackIgnore: true */ configuredRootfsPath) : null,
      runtimeRoot: path.resolve(/* turbopackIgnore: true */ read("ASKME_CODE_AGENT_RUNTIME_ROOT") ?? path.join(os.homedir(), ".askme/boxlite")),
      promptVersion: read("ASKME_CODE_AGENT_PROMPT_VERSION") ?? "repository-code-agent-v1",
      createTimeoutMs: integer("ASKME_CODE_AGENT_CREATE_TIMEOUT_MS", 30_000, 1_000, 300_000),
      cleanupTimeoutMs: integer("ASKME_CODE_AGENT_CLEANUP_TIMEOUT_MS", 30_000, 1_000, 300_000),
      cpus: integer("ASKME_CODE_AGENT_CPUS", 1, 1, 16),
      memoryMib: integer("ASKME_CODE_AGENT_MEMORY_MIB", 1_024, 128, 32_768),
      diskSizeGb: integer("ASKME_CODE_AGENT_DISK_GIB", 2, 1, 100),
      globalConcurrency: integer("ASKME_CODE_AGENT_GLOBAL_CONCURRENCY", 2, 2, 100),
      leaseMs: codeAgentLeaseMs,
      heartbeatMs: codeAgentHeartbeatMs,
      pollMs: integer("ASKME_CODE_AGENT_POLL_MS", 1_000, 100, 60_000),
      dailyQuotas: {
        global: integer("ASKME_CODE_AGENT_GLOBAL_DAILY_QUOTA", 1_000, 1, 1_000_000),
        candidate: integer("ASKME_CODE_AGENT_CANDIDATE_DAILY_QUOTA", 50, 1, 100_000),
        repository: integer("ASKME_CODE_AGENT_REPOSITORY_DAILY_QUOTA", 10, 1, 10_000),
      },
      budgets: {
        repositoryAnalysis: {
          ...baseBudget,
          analysisTimeoutMs: integer("ASKME_CODE_AGENT_REPOSITORY_ANALYSIS_TIMEOUT_MS", 1_200_000, 1_000, 3_600_000),
        },
        conversationAnalysis: {
          ...baseBudget,
          analysisTimeoutMs: integer("ASKME_CODE_AGENT_ANALYSIS_TIMEOUT_MS", 120_000, 1_000, 600_000),
        },
      },
    },
    bootstrap: {
      candidateEmail: read("ASKME_CANDIDATE_EMAIL"),
      candidatePassword: read("ASKME_CANDIDATE_PASSWORD"),
      adminEmail: read("ASKME_ADMIN_EMAIL"),
      adminPassword: read("ASKME_ADMIN_PASSWORD"),
    },
    mail: {
      status: !mailProvided ? "not_configured" : mailValid ? "configured" : "invalid_configuration",
      host: mailHost,
      port: Number.isInteger(mailPort) && mailPort >= 1 && mailPort <= 65_535 ? mailPort : 587,
      secure: mailSecure,
      user: mailUser,
      password: mailPassword,
      from: mailFrom,
    },
  };
}

let cachedConfig: RuntimeConfig | undefined;

export function getRuntimeConfig() {
  if (cachedConfig) return cachedConfig;
  let userEnvFile = "";
  try {
    userEnvFile = readFileSync(path.join(os.homedir(), ".env"), "utf8");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (code !== "ENOENT") throw error;
  }
  cachedConfig = loadConfigFromSources(process.env, userEnvFile);
  return cachedConfig;
}

export function requireDatabaseUrl() {
  const value = getRuntimeConfig().databaseUrl;
  if (!value) throw new Error("DATABASE_URL is required");
  return value;
}
