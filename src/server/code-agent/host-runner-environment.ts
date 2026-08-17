import path from "node:path";

type EnvSource = Record<string, string | undefined>;

const HOST_KEYS = new Set([
  "DATABASE_URL",
  "ASKME_POSTGRES_USER",
  "ASKME_POSTGRES_PASSWORD",
  "ASKME_POSTGRES_DB",
  "ASKME_POSTGRES_PORT",
  "ASKME_WEB_PORT",
  "ASKME_REPOSITORY_ARTIFACT_ROOT",
  "ASKME_REPOSITORY_ARTIFACT_HOST_ROOT",
  "ASKME_CODE_AGENT_ROOTFS_PATH",
  "ASKME_CODE_AGENT_RUNTIME_ROOT",
  "ASKME_CODE_AGENT_IMAGE_DIGEST",
]);

function unquote(value: string) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseHostEnv(source: string) {
  const result: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (key && rawValue !== undefined && HOST_KEYS.has(key)) result[key] = unquote(rawValue);
  }
  return result;
}

function layeredReader(processEnv: EnvSource, projectEnvFile: string, userEnvFile: string) {
  const projectEnv = parseHostEnv(projectEnvFile);
  const userEnv = parseHostEnv(userEnvFile);
  return (key: string) => processEnv[key]?.trim() || projectEnv[key]?.trim() || userEnv[key]?.trim() || null;
}

function port(value: string | null, fallback: number, key: string) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error(`${key} must be an integer between 1 and 65535`);
  return parsed;
}

export function resolveHostRunnerSettings(input: {
  processEnv: EnvSource;
  projectEnvFile: string;
  userEnvFile: string;
}) {
  const read = layeredReader(input.processEnv, input.projectEnvFile, input.userEnvFile);
  const databaseUrl = read("DATABASE_URL") ?? [
    "postgresql://",
    encodeURIComponent(read("ASKME_POSTGRES_USER") ?? "askme"),
    ":",
    encodeURIComponent(read("ASKME_POSTGRES_PASSWORD") ?? "askme-local-only"),
    "@127.0.0.1:",
    String(port(read("ASKME_POSTGRES_PORT"), 55_432, "ASKME_POSTGRES_PORT")),
    "/",
    encodeURIComponent(read("ASKME_POSTGRES_DB") ?? "askme"),
  ].join("");

  return {
    databaseUrl,
    webPort: port(read("ASKME_WEB_PORT"), 3_000, "ASKME_WEB_PORT"),
  };
}

export function prepareHostRunnerEnvironment(input: {
  processEnv: EnvSource;
  projectEnvFile: string;
  userEnvFile: string;
  projectRoot?: string;
}) {
  const read = layeredReader(input.processEnv, input.projectEnvFile, input.userEnvFile);
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const settings = resolveHostRunnerSettings(input);
  const environment = Object.fromEntries(
    Object.entries(input.processEnv).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

  environment.DATABASE_URL = settings.databaseUrl;
  environment.ASKME_REPOSITORY_ARTIFACT_ROOT = path.resolve(read("ASKME_REPOSITORY_ARTIFACT_ROOT") ?? read("ASKME_REPOSITORY_ARTIFACT_HOST_ROOT") ?? path.join(projectRoot, "data/repository-artifacts"));
  environment.ASKME_CODE_AGENT_ROOTFS_PATH = path.resolve(read("ASKME_CODE_AGENT_ROOTFS_PATH") ?? path.join(projectRoot, "data/code-agent-image"));
  environment.ASKME_CODE_AGENT_RUNTIME_ROOT = path.resolve(read("ASKME_CODE_AGENT_RUNTIME_ROOT") ?? path.join(projectRoot, "data/boxlite"));
  const imageDigest = read("ASKME_CODE_AGENT_IMAGE_DIGEST");
  if (imageDigest) environment.ASKME_CODE_AGENT_IMAGE_DIGEST = imageDigest;
  else delete environment.ASKME_CODE_AGENT_IMAGE_DIGEST;
  delete environment.ASKME_GITHUB_TEST_TOKEN;
  return environment;
}
