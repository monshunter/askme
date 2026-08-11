import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ALLOWED_KEYS = new Set([
  "DATABASE_URL",
  "UPLOAD_ROOT",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  "ASKME_CANDIDATE_EMAIL",
  "ASKME_CANDIDATE_PASSWORD",
  "ASKME_ADMIN_EMAIL",
  "ASKME_ADMIN_PASSWORD",
  "ASKME_SMTP_HOST",
  "ASKME_SMTP_PORT",
  "ASKME_SMTP_SECURE",
  "ASKME_SMTP_USER",
  "ASKME_SMTP_PASSWORD",
  "ASKME_SMTP_FROM",
]);

type EnvSource = Record<string, string | undefined>;

export type RuntimeConfig = {
  databaseUrl: string | null;
  uploadRoot: string;
  deepseek: {
    apiKey: string | null;
    baseUrl: string;
    model: string;
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

  return {
    databaseUrl: read("DATABASE_URL"),
    uploadRoot: read("UPLOAD_ROOT") ?? path.resolve(process.cwd(), "data/uploads"),
    deepseek: {
      apiKey: read("DEEPSEEK_API_KEY"),
      baseUrl: read("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com",
      model: read("DEEPSEEK_MODEL") ?? "deepseek-v4-flash",
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
