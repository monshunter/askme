import { mkdirSync, readFileSync } from "node:fs";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { JsBoxlite } from "@boxlite-ai/boxlite";
import type { JsBox, JsBoxlite as BoxliteRuntime } from "@boxlite-ai/boxlite/dist/native-contracts.js";

import type { AiProfile, CodeAgentBudget, RuntimeConfig } from "@/server/config";
import { AppError } from "@/server/errors";
import { resolveRepositoryArtifactFiles, type RepositoryArtifactDescriptor } from "@/server/repositories/artifact-reader";
import { MAX_WIKI_BUNDLE_BYTES, MAX_WIKI_FILES, MAX_WIKI_PAGE_BYTES } from "@/server/repositories/dossier-output";

import { parseGuestCodeAgentEnvelope, type GuestCodeAgentEnvelope } from "../contracts";

const MAX_GUEST_STDIO_BYTES = 2 * 1024 * 1024;
const SECRET_PLACEHOLDER = "ASKME_BOXLITE_RUNTIME_API_KEY";

type CodeAgentConfig = RuntimeConfig["codeAgent"];

export type CodeAgentSandboxInput = {
  runId: string;
  purpose: "repository_analysis" | "conversation_analysis";
  prompt: string;
  skillName: "repository-analysis" | "code-question-answering";
  promptVersion: string;
  artifactRoot: string;
  artifact: RepositoryArtifactDescriptor;
  eligibleFileCount: number;
  profile: AiProfile;
  aiBaseUrl: string;
  aiApiKey: string;
  budget: CodeAgentBudget;
  signal?: AbortSignal;
  onCreated?: (microvmId: string) => Promise<void>;
  validateEnvelope?: (envelope: GuestCodeAgentEnvelope, wikiFiles: ReadonlyMap<string, string>) => Promise<void>;
  correctionPrompt?: (errorCode: string, envelope: GuestCodeAgentEnvelope) => string;
};

export type CodeAgentSandboxResult = {
  microvmId: string;
  envelope: GuestCodeAgentEnvelope;
  wikiFiles: ReadonlyMap<string, string>;
  cleanupCompletedAt: Date;
  usedInGuestSecretFallback: boolean;
};

function isSafeWikiPath(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}\.md$/.test(value)
    && !value.split("/").some((part) => part === "." || part === ".." || part.startsWith("."));
}

async function collectCopiedWikiFiles(root: string) {
  const files = new Map<string, string>();
  let totalBytes = 0;
  const visit = async (directory: string, relativeRoot = "") => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.posix.join(relativeRoot, entry.name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw new AppError("WIKI_FILE_UNSAFE", "The sandbox Wiki output contains a symbolic link.", 422);
      if (stat.isDirectory()) {
        if (entry.name.startsWith(".")) throw new AppError("WIKI_FILE_UNSAFE", "The sandbox Wiki output contains a hidden directory.", 422);
        await visit(absolute, relative);
        continue;
      }
      if (!stat.isFile() || !isSafeWikiPath(relative)) throw new AppError("WIKI_FILE_UNSAFE", "The sandbox Wiki output contains an invalid file.", 422);
      if (files.size >= MAX_WIKI_FILES) throw new AppError("WIKI_FILES_TOO_LARGE", "The sandbox Wiki output contains too many files.", 413);
      const bytes = await readFile(absolute);
      totalBytes += bytes.byteLength;
      if (bytes.byteLength > MAX_WIKI_PAGE_BYTES || totalBytes > MAX_WIKI_BUNDLE_BYTES) {
        throw new AppError("WIKI_FILES_TOO_LARGE", "The sandbox Wiki output exceeds its configured size limit.", 413);
      }
      let markdown: string;
      try {
        markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new AppError("WIKI_FILE_ENCODING_INVALID", "The sandbox Wiki output is not valid UTF-8.", 422);
      }
      files.set(relative, markdown);
    }
  };
  await visit(root);
  if (files.size === 0) throw new AppError("WIKI_FILES_INVALID", "The sandbox did not generate any Wiki Markdown files.", 422);
  return files;
}

const PREPARE_WIKI_OUTPUT_SCRIPT = [
  "const fs=require('node:fs');",
  "const root='/workspace/output/wiki';",
  "fs.rmSync(root,{recursive:true,force:true});",
  "fs.mkdirSync(root,{recursive:true,mode:0o777});",
  "fs.chmodSync(root,0o777);",
].join("");

const AUDIT_WIKI_OUTPUT_SCRIPT = [
  "const fs=require('node:fs'),p=require('node:path');",
  "const root='/workspace/output/wiki';let count=0,total=0;",
  "function walk(dir){for(const name of fs.readdirSync(dir)){const file=p.join(dir,name),s=fs.lstatSync(file);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory()){walk(file);continue;}if(!s.isFile())throw Error('non-file');count++;total+=s.size;if(count>32||s.size>500000||total>1048576)throw Error('limit');}}",
  "walk(root);process.stdout.write(JSON.stringify({count,total}));",
].join("");

function mergeRepositoryCorrectionCoverage(first: GuestCodeAgentEnvelope, corrected: GuestCodeAgentEnvelope, eligibleFileCount: number) {
  if (first.purpose !== "repository_analysis" || corrected.purpose !== "repository_analysis") return corrected.result;
  const firstResult = first.result && typeof first.result === "object" ? first.result as Record<string, unknown> : null;
  const correctedResult = corrected.result && typeof corrected.result === "object" ? corrected.result as Record<string, unknown> : null;
  const firstCoverage = firstResult?.coverage && typeof firstResult.coverage === "object" ? firstResult.coverage as Record<string, unknown> : null;
  const correctedCoverage = correctedResult?.coverage && typeof correctedResult.coverage === "object" ? correctedResult.coverage as Record<string, unknown> : null;
  if (!correctedResult || !correctedCoverage) return corrected.result;
  const observed = [...new Set([
    ...(Array.isArray(firstCoverage?.examinedPaths) ? firstCoverage.examinedPaths : []),
    ...(Array.isArray(correctedCoverage.examinedPaths) ? correctedCoverage.examinedPaths : []),
  ].filter((value): value is string => typeof value === "string"))].sort();
  return {
    ...correctedResult,
    coverage: {
      ...correctedCoverage,
      eligibleFileCount,
      examinedFileCount: observed.length,
      examinedPaths: observed,
      skipped: [{ reason: "scope", count: Math.max(0, eligibleFileCount - observed.length) }],
    },
  };
}

function timeout<T>(promise: Promise<T>, timeoutMs: number, code: string, message: string) {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new AppError(code, message, 504)), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

async function collectStream(stream: { next(): Promise<string | null> }, execution: { kill(): Promise<void> }) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  while (true) {
    const chunk = await stream.next();
    if (chunk === null) break;
    const value = Buffer.from(chunk, "utf8");
    bytes += value.byteLength;
    if (bytes > MAX_GUEST_STDIO_BYTES) {
      await execution.kill().catch(() => undefined);
      throw new AppError("CODE_AGENT_OUTPUT_TOO_LARGE", "The Code Agent runtime output exceeded its limit.", 502);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function execute(
  box: JsBox,
  command: string,
  args: string[],
  options: { user: string; timeoutMs: number; cwd?: string; input?: string; signal?: AbortSignal },
) {
  if (options.signal?.aborted) throw new AppError("CODE_AGENT_CANCELLED", "The Code Agent run was cancelled.", 409);
  const execution = await box.exec(command, args, null, false, options.user, Math.max(1, Math.ceil(options.timeoutMs / 1_000)), options.cwd ?? null);
  const [stdoutStream, stderrStream] = await Promise.all([execution.stdout(), execution.stderr()]);
  if (options.input !== undefined) {
    const stdin = await execution.stdin();
    await stdin.writeString(options.input);
    await stdin.close();
  }
  const onAbort = () => void execution.kill().catch(() => undefined);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const [stdout, stderr, result] = await Promise.all([
      collectStream(stdoutStream, execution),
      collectStream(stderrStream, execution),
      execution.wait(),
    ]);
    if (options.signal?.aborted) throw new AppError("CODE_AGENT_CANCELLED", "The Code Agent run was cancelled.", 409);
    return { stdout, stderr, exitCode: result.exitCode };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function endpointPolicy(baseUrl: string) {
  let endpoint: URL;
  try {
    endpoint = new URL(baseUrl);
  } catch {
    throw new AppError("CODE_AGENT_ENDPOINT_INVALID", "The Code Agent endpoint configuration is invalid.", 500);
  }
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new AppError("CODE_AGENT_ENDPOINT_INVALID", "The Code Agent endpoint protocol is not supported.", 500);
  }
  return { endpoint, allowNet: [endpoint.hostname] };
}

export function classifyGuestFailure(stderr: string) {
  const classified = /CODE_AGENT_GUEST_FAILURE:(control|model|resources|session|prompt|output):(UNKNOWN|AUTH|MODEL|REQUEST|OUTPUT):([A-Z0-9]{1,64})/.exec(stderr);
  if (classified) return `CODE_AGENT_GUEST_${classified[1]!.toUpperCase()}_${classified[2]}_${classified[3]}_FAILED`;
  if (stderr.includes("product skill isolation failed")) return "CODE_AGENT_SKILL_ISOLATION_FAILED";
  if (stderr.includes("read-only tool isolation failed")) return "CODE_AGENT_TOOL_ISOLATION_FAILED";
  if (stderr.includes("configured model is unavailable")) return "CODE_AGENT_MODEL_UNAVAILABLE";
  if (stderr.includes("control input") || stderr.includes("control budget") || stderr.includes("control purpose") || stderr.includes("control skill")) return "CODE_AGENT_CONTROL_INVALID";
  if (stderr.includes("ERR_MODULE_NOT_FOUND") || stderr.includes("Cannot find package")) return "CODE_AGENT_GUEST_RUNTIME_INVALID";
  if (stderr.includes("ECONN") || stderr.includes("fetch failed") || stderr.includes("network")) return "CODE_AGENT_AI_UPSTREAM_UNREACHABLE";
  return "CODE_AGENT_GUEST_FAILED";
}

export function reachedAnalysisDeadline(startedAtMs: number, finishedAtMs: number, timeoutMs: number) {
  return finishedAtMs - startedAtMs >= timeoutMs - 1_000;
}

export class BoxliteCodeAgentSandbox {
  private readonly runtime: BoxliteRuntime;
  private closed = false;

  constructor(private readonly config: CodeAgentConfig, runtime?: BoxliteRuntime) {
    if (!config.imageDigest) throw new AppError("CODE_AGENT_IMAGE_UNPINNED", "The Code Agent image digest is not configured.", 503);
    if (config.rootfsPath) {
      let actualDigest: unknown;
      try {
        const index = JSON.parse(readFileSync(path.join(config.rootfsPath, "index.json"), "utf8")) as { manifests?: Array<{ digest?: unknown }> };
        actualDigest = index.manifests?.[0]?.digest;
      } catch {
        throw new AppError("CODE_AGENT_IMAGE_UNAVAILABLE", "The pinned Code Agent OCI layout is unavailable.", 503);
      }
      if (actualDigest !== config.imageDigest) throw new AppError("CODE_AGENT_IMAGE_DIGEST_MISMATCH", "The Code Agent OCI layout does not match its configured digest.", 503);
    } else if (!config.image.includes(`@${config.imageDigest}`)) {
      throw new AppError("CODE_AGENT_IMAGE_UNPINNED", "The remote Code Agent image reference must include its configured digest.", 503);
    }
    mkdirSync(config.runtimeRoot, { recursive: true, mode: 0o700 });
    this.runtime = runtime ?? new JsBoxlite({ homeDir: config.runtimeRoot });
  }

  async run(input: CodeAgentSandboxInput): Promise<CodeAgentSandboxResult> {
    if (this.closed) throw new AppError("CODE_AGENT_RUNTIME_CLOSED", "The Code Agent runtime is closed.", 503);
    if (!input.aiApiKey.trim()) throw new AppError("CODE_AGENT_AI_UNAVAILABLE", "The Code Agent AI credential is not configured.", 503);
    const { endpoint, allowNet } = endpointPolicy(input.aiBaseUrl);
    const { artifactPath, manifestPath } = resolveRepositoryArtifactFiles(input.artifactRoot, input.artifact);
    const useSecretProxy = false;
    const boxOptions = {
      ...(this.config.rootfsPath ? { rootfsPath: this.config.rootfsPath } : { image: this.config.image }),
      cpus: this.config.cpus,
      memoryMib: this.config.memoryMib,
      diskSizeGb: this.config.diskSizeGb,
      workingDir: "/workspace/source",
      network: { mode: "enabled" as const, allowNet },
      secrets: useSecretProxy ? [{ name: "askme-ai-api-key", value: input.aiApiKey, hosts: [endpoint.hostname], placeholder: SECRET_PLACEHOLDER }] : [],
      entrypoint: ["sleep"],
      cmd: ["infinity"],
      user: "root",
      autoRemove: true,
      detach: false,
      security: {
        jailerEnabled: true,
        seccompEnabled: process.platform === "linux",
        networkEnabled: process.platform === "darwin",
        closeFds: true,
        maxOpenFiles: 512,
        maxProcesses: 256,
      },
    };
    let box: JsBox | null = null;
    let validatedEnvelope: GuestCodeAgentEnvelope | null = null;
    let validatedWikiFiles: ReadonlyMap<string, string> = new Map();
    let microvmId = "";
    let cleanupCompletedAt: Date | null = null;
    let cleanupError: unknown;
    let runError: unknown;
    let stage = "create";
    try {
      box = await timeout(
        this.runtime.create(boxOptions, `askme-${input.runId}`),
        this.config.createTimeoutMs,
        "CODE_AGENT_CREATE_TIMEOUT",
        "The Code Agent sandbox did not start in time.",
      );
      microvmId = box.id;
      await input.onCreated?.(microvmId);
      if (input.signal?.aborted) throw new AppError("CODE_AGENT_CANCELLED", "The Code Agent run was cancelled.", 409);
      stage = "copy";
      await box.copyIn(artifactPath, "/workspace/input/repository.tar.zst", { overwrite: false });
      await box.copyIn(manifestPath, "/workspace/input/manifest.json", { overwrite: false });
      if (input.signal?.aborted) throw new AppError("CODE_AGENT_CANCELLED", "The Code Agent run was cancelled.", 409);
      stage = "bootstrap";
      const bootstrap = await execute(box, "node", ["/opt/askme-code-agent/extract.mjs", input.artifact.checksum, input.artifact.manifestChecksum], {
        user: "root",
        timeoutMs: this.config.createTimeoutMs,
      });
      if (bootstrap.exitCode !== 0) throw new AppError("CODE_AGENT_ARTIFACT_BOOTSTRAP_FAILED", "The Code Agent could not verify its immutable Repository Artifact.", 502);
      if (input.signal?.aborted) throw new AppError("CODE_AGENT_CANCELLED", "The Code Agent run was cancelled.", 409);
      stage = "readonly_probe";
      const readonlyProbe = await execute(box, "node", ["-e", "require('node:fs').accessSync('/workspace/source', require('node:fs').constants.W_OK)"], {
        user: "node",
        timeoutMs: 5_000,
        cwd: "/workspace/source",
      });
      if (readonlyProbe.exitCode === 0) throw new AppError("CODE_AGENT_SOURCE_WRITABLE", "The Code Agent repository source is unexpectedly writable.", 500);

      stage = "guest";
      const runGuest = async (prompt: string, budget: CodeAgentBudget, maxTokens: number, minimumExaminedPaths: number) => {
        if (input.purpose === "repository_analysis") {
          const prepared = await execute(box!, "node", ["-e", PREPARE_WIKI_OUTPUT_SCRIPT], {
            user: "root",
            timeoutMs: 5_000,
          });
          if (prepared.exitCode !== 0) throw new AppError("WIKI_OUTPUT_PREPARE_FAILED", "The sandbox Wiki output directory could not be prepared.", 502);
        }
        const control = JSON.stringify({
          purpose: input.purpose,
          baseUrl: input.aiBaseUrl,
          apiKey: useSecretProxy ? SECRET_PLACEHOLDER : input.aiApiKey,
          model: input.profile.model,
          thinking: input.profile.thinking,
          skillName: input.skillName,
          prompt,
          promptVersion: input.promptVersion,
          commitSha: input.artifact.commitSha,
          eligibleFileCount: input.eligibleFileCount,
          minimumExaminedPaths,
          maxRounds: budget.maxRounds,
          maxToolCalls: budget.maxToolCalls,
          maxAggregateToolOutputBytes: budget.maxAggregateToolOutputBytes,
          maxReadBytes: budget.maxReadBytes,
          maxReadLines: budget.maxReadLines,
          maxSearchHits: budget.maxSearchHits,
          maxTokens,
          contextWindow: input.profile.contextWindow,
        });
        const guestStartedAt = Date.now();
        const guest = await execute(box!, "node", ["/opt/askme-code-agent/run.mjs"], {
          user: "node",
          timeoutMs: budget.analysisTimeoutMs,
          cwd: "/workspace/source",
          input: control,
          signal: input.signal,
        });
        if (guest.exitCode !== 0) {
          if (reachedAnalysisDeadline(guestStartedAt, Date.now(), budget.analysisTimeoutMs)) {
            throw new AppError("CODE_AGENT_ANALYSIS_TIMEOUT", "The isolated Code Agent run reached its analysis deadline.", 504);
          }
          const guestFailure = classifyGuestFailure(guest.stderr);
          throw new AppError(guestFailure, "The isolated Code Agent run failed.", 502);
        }
        let guestResult: unknown;
        try {
          guestResult = JSON.parse(guest.stdout.trim());
        } catch {
          throw new AppError("CODE_AGENT_RESULT_INVALID", "The Code Agent returned invalid structured output.", 502);
        }
        return parseGuestCodeAgentEnvelope(guestResult, {
          purpose: input.purpose,
          commitSha: input.artifact.commitSha,
          skillName: input.skillName,
          promptVersion: input.promptVersion,
          configuredModel: input.profile.model,
          maxTokens,
          budget,
        });
      };
      const copyWikiFiles = async () => {
        if (input.purpose !== "repository_analysis") return new Map<string, string>();
        const audit = await execute(box!, "node", ["-e", AUDIT_WIKI_OUTPUT_SCRIPT], { user: "root", timeoutMs: 5_000 });
        if (audit.exitCode !== 0) throw new AppError("WIKI_FILE_UNSAFE", "The sandbox Wiki output failed its in-guest file audit.", 422);
        const hostRoot = await mkdtemp(path.join(os.tmpdir(), "askme-wiki-"));
        try {
          await box!.copyOut("/workspace/output/wiki", hostRoot, {
            recursive: true,
            // BoxLite 0.9.7 requires overwrite=true when copying directory contents
            // into an already-created host destination, even when that destination is empty.
            overwrite: true,
            followSymlinks: false,
            includeParent: false,
          });
          return await collectCopiedWikiFiles(hostRoot);
        } finally {
          await rm(hostRoot, { recursive: true, force: true });
        }
      };
      const first = await runGuest(input.prompt, input.budget, input.profile.maxTokens, input.purpose === "repository_analysis" && input.eligibleFileCount >= 100 ? 30 : 0);
      const firstWikiFiles = await copyWikiFiles();
      validatedEnvelope = first;
      validatedWikiFiles = firstWikiFiles;
      if (input.validateEnvelope) {
        try {
          await input.validateEnvelope(first, firstWikiFiles);
        } catch (error) {
          const safe = error instanceof AppError ? error : new AppError("CODE_AGENT_RESULT_INVALID", "The Code Agent result failed Host validation.", 502);
          console.warn(JSON.stringify({ event: "code-agent.result.validation_failed", runId: input.runId, purpose: input.purpose, errorCode: safe.code, correction: false }));
          const remaining = {
            ...input.budget,
            analysisTimeoutMs: Math.max(1_000, input.budget.analysisTimeoutMs - 1_000),
            maxRounds: input.budget.maxRounds - first.usage.rounds,
            maxToolCalls: input.budget.maxToolCalls - first.usage.toolCalls,
            maxAggregateToolOutputBytes: input.budget.maxAggregateToolOutputBytes - first.usage.aggregateToolOutputBytes,
          };
          const remainingTokens = input.profile.maxTokens - first.usage.outputTokens;
          if (!input.correctionPrompt || remaining.maxRounds < 1 || remaining.maxToolCalls < 1 || remaining.maxAggregateToolOutputBytes < 1_024 || remainingTokens < 1) throw safe;
          const corrected = await runGuest(input.correctionPrompt(safe.code, first), remaining, remainingTokens, 0);
          const correctedWikiFiles = await copyWikiFiles();
          validatedEnvelope = {
            ...corrected,
            result: mergeRepositoryCorrectionCoverage(first, corrected, input.eligibleFileCount),
            usage: {
              inputTokens: first.usage.inputTokens + corrected.usage.inputTokens,
              outputTokens: first.usage.outputTokens + corrected.usage.outputTokens,
              totalTokens: first.usage.totalTokens + corrected.usage.totalTokens,
              rounds: first.usage.rounds + corrected.usage.rounds,
              toolCalls: first.usage.toolCalls + corrected.usage.toolCalls,
              aggregateToolOutputBytes: first.usage.aggregateToolOutputBytes + corrected.usage.aggregateToolOutputBytes,
              examinedFileCount: Math.max(first.usage.examinedFileCount, corrected.usage.examinedFileCount),
              truncatedToolOutputs: first.usage.truncatedToolOutputs + corrected.usage.truncatedToolOutputs,
            },
          };
          validatedWikiFiles = correctedWikiFiles;
          try {
            await input.validateEnvelope(validatedEnvelope, correctedWikiFiles);
          } catch (error) {
            const correction = error instanceof AppError ? error : new AppError("CODE_AGENT_RESULT_INVALID", "The corrected Code Agent result failed Host validation.", 502);
            console.warn(JSON.stringify({ event: "code-agent.result.validation_failed", runId: input.runId, purpose: input.purpose, errorCode: correction.code, correction: true }));
            throw new AppError("CODE_AGENT_CORRECTION_FAILED", "The Code Agent result remained invalid after one bounded correction.", 502, {
              initialValidationErrorCode: safe.code,
              correctionValidationErrorCode: correction.code,
            });
          }
        }
      }
    } catch (error) {
      runError = error instanceof AppError ? error : new AppError("CODE_AGENT_SANDBOX_FAILED", "The isolated Code Agent run failed.", 502, { stage });
    } finally {
      if (box) {
        try {
          await timeout(box.stop(), this.config.cleanupTimeoutMs, "CODE_AGENT_CLEANUP_TIMEOUT", "The Code Agent sandbox cleanup timed out.");
          cleanupCompletedAt = new Date();
        } catch (error) {
          cleanupError = error;
        }
      }
    }
    if (cleanupError || !cleanupCompletedAt) {
      throw new AppError("CODE_AGENT_CLEANUP_FAILED", "The Code Agent sandbox could not be cleaned up safely.", 500);
    }
    if (runError) {
      const safe = runError instanceof AppError ? runError : new AppError("CODE_AGENT_SANDBOX_FAILED", "The isolated Code Agent run failed.", 502);
      throw new AppError(safe.code, safe.message, safe.status, { ...safe.details, cleanupCompletedAt: cleanupCompletedAt.toISOString() });
    }
    if (!validatedEnvelope) throw new AppError("CODE_AGENT_SANDBOX_FAILED", "The isolated Code Agent run did not produce a result.", 502);
    return { microvmId, envelope: validatedEnvelope, wikiFiles: validatedWikiFiles, cleanupCompletedAt, usedInGuestSecretFallback: !useSecretProxy };
  }

  async removeStaleMicrovm(microvmId: string) {
    if (!microvmId) return;
    const box = await this.runtime.get(microvmId);
    if (!box) return;
    await timeout(box.stop(), this.config.cleanupTimeoutMs, "CODE_AGENT_CLEANUP_TIMEOUT", "A stale Code Agent sandbox cleanup timed out.");
    const remaining = await this.runtime.getInfo(microvmId);
    if (remaining) throw new AppError("CODE_AGENT_CLEANUP_FAILED", "A stale Code Agent sandbox could not be removed.", 500);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.runtime.shutdown(Math.ceil(this.config.cleanupTimeoutMs / 1_000));
    this.runtime.close();
  }
}
