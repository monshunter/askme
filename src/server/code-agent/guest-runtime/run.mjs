import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import { InMemoryCredentialStore, InMemoryModelsStore, Type } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { repositorySourceToolsShouldLock } from "./budget-policy.mjs";
import { boundedCitationRanges, sourceLines } from "./citation-ranges.mjs";
import { parseFinalJson, selectFinalAssistantText } from "./final-output.mjs";
import { missingFactualSectionCitations } from "./wiki-markdown-policy.mjs";

const SOURCE_ROOT = "/workspace/source";
const WIKI_ROOT = "/workspace/output/wiki";
const SKILLS_ROOT = "/opt/askme-code-agent/skills";
const MAX_CONTROL_BYTES = 64 * 1024;
const MAX_WIKI_FILES = 32;
const MAX_WIKI_PAGE_BYTES = 500_000;
const MAX_WIKI_BUNDLE_BYTES = 1024 * 1024;
let guestStage = "control";
let guestCode = "UNKNOWN";
let guestName = "UNKNOWN";

function classifyModelError(message, fallbackName) {
  if (/\b(401|403)\b|api[_ -]?key|auth/i.test(message)) return { code: "AUTH", name: "AUTH" };
  if (/\b404\b|model/i.test(message)) return { code: "MODEL", name: "MODEL" };
  if (/\b429\b|rate.?limit/i.test(message)) return { code: "REQUEST", name: "RATELIMIT" };
  if (/\b400\b|bad request/i.test(message)) return { code: "REQUEST", name: "BADREQUEST" };
  if (/\b(500|502|503|504)\b/i.test(message)) return { code: "REQUEST", name: "UPSTREAM" };
  if (/fetch|network|ECONN|ETIMEDOUT/i.test(message)) return { code: "REQUEST", name: "NETWORK" };
  return { code: "REQUEST", name: fallbackName };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function textResult(text, details) {
  return { content: [{ type: "text", text }], details };
}

function createBudget(input) {
  const state = {
    aggregateOutputBytes: 0,
    examinedPaths: new Set(),
    rounds: 0,
    toolCalls: 0,
    truncatedToolOutputs: 0,
    exhausted: null,
    wikiFiles: new Map(),
  };
  const emit = (text) => {
    const remaining = input.maxAggregateToolOutputBytes - state.aggregateOutputBytes;
    if (remaining <= 0) {
      state.exhausted = "aggregate_tool_output";
      throw new Error("aggregate tool output budget exhausted");
    }
    const bytes = Buffer.from(text, "utf8");
    if (bytes.byteLength <= remaining) {
      state.aggregateOutputBytes += bytes.byteLength;
      return text;
    }
    const suffix = "\n[truncated: aggregate tool output budget reached]";
    const available = Math.max(0, remaining - Buffer.byteLength(suffix));
    const truncated = bytes.subarray(0, available).toString("utf8") + suffix;
    state.aggregateOutputBytes += Buffer.byteLength(truncated);
    state.truncatedToolOutputs += 1;
    state.exhausted = "aggregate_tool_output";
    return truncated;
  };
  const startTool = () => {
    state.toolCalls += 1;
    if (state.toolCalls > input.maxToolCalls) {
      state.exhausted = "tool_calls";
      throw new Error("tool call budget exhausted");
    }
  };
  return { state, emit, startTool };
}

function safeRelativePath(input = ".") {
  if (typeof input !== "string" || input.includes("\0")) throw new Error("invalid path");
  const absolute = path.resolve(SOURCE_ROOT, input);
  const relative = path.relative(SOURCE_ROOT, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("path is outside the repository source root");
  return { absolute, relative: relative.split(path.sep).join("/") || "." };
}

function safeWikiPath(input) {
  if (typeof input !== "string" || input.includes("\0") || input.length > 256 || !input.endsWith(".md")) throw new Error("invalid Wiki path");
  const normalized = input.split("\\").join("/");
  const parts = normalized.split("/");
  if (path.isAbsolute(normalized) || parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) throw new Error("invalid Wiki path");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*\.md$/.test(normalized)) throw new Error("invalid Wiki path");
  const absolute = path.resolve(WIKI_ROOT, normalized);
  if (path.relative(WIKI_ROOT, absolute).startsWith("..")) throw new Error("Wiki path is outside the output root");
  return { absolute, relative: normalized };
}

async function requireRegularFile(input) {
  const resolved = safeRelativePath(input);
  const stat = await lstat(resolved.absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("path is not a regular repository file");
  return resolved;
}

async function walkFiles(input, maxFiles = 50_000) {
  const root = safeRelativePath(input);
  const rootStat = await lstat(root.absolute);
  if (rootStat.isFile()) return [root];
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("path is not a repository directory");
  const files = [];
  const pending = [root];
  while (pending.length > 0 && files.length < maxFiles) {
    const current = pending.pop();
    const entries = await readdir(current.absolute, { withFileTypes: true });
    entries.sort((left, right) => right.name.localeCompare(left.name));
    for (const entry of entries) {
      const child = safeRelativePath(path.join(current.relative, entry.name));
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile()) files.push(child);
      if (files.length >= maxFiles) break;
    }
  }
  return files.sort((left, right) => left.relative.localeCompare(right.relative));
}

function createTools(budget, limits, purpose, onSourceToolsLocked) {
  const sourceToolNames = new Set(["ls", "find", "grep", "read"]);
  let sourceToolsLocked = false;
  const lockSourceTools = () => {
    if (sourceToolsLocked) return;
    sourceToolsLocked = true;
    onSourceToolsLocked();
  };
  const shouldLockSourceTools = () => purpose === "repository_analysis"
    && repositorySourceToolsShouldLock({
      maxRounds: limits.maxRounds,
      maxToolCalls: limits.maxToolCalls,
      rounds: budget.state.rounds,
      toolCalls: budget.state.toolCalls,
      examinedPathCount: budget.state.examinedPaths.size,
      minimumExaminedPaths: limits.minimumExaminedPaths,
    });
  const wrap = (name, label, description, parameters, execute) => ({
    name,
    label,
    description,
    promptSnippet: description,
    parameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error("tool call aborted");
      if (sourceToolNames.has(name) && shouldLockSourceTools()) {
        lockSourceTools();
        return textResult("[source tools locked: the remaining round and tool-call budget is reserved for write_wiki; write every Wiki page now and return the final manifest]", { sourceToolsLocked: true });
      }
      budget.startTool();
      const result = await execute(params, signal);
      if (sourceToolNames.has(name) && shouldLockSourceTools()) lockSourceTools();
      const remainingCalls = limits.maxToolCalls - budget.state.toolCalls;
      const remainingRounds = limits.maxRounds - budget.state.rounds;
      const guidance = sourceToolsLocked
        ? `\n[source tools locked: ${remainingRounds} rounds and ${remainingCalls} calls remain for write_wiki and the final manifest]`
        : remainingCalls <= 10 || remainingRounds <= 10
          ? `\n[budget warning: ${remainingRounds} rounds and ${remainingCalls} tool calls remain; stop exploring now, ${purpose === "repository_analysis" ? "write every Wiki page and return the final manifest" : "return the final supported answer"}]`
        : `\n[budget: ${remainingRounds} rounds and ${remainingCalls} tool calls remain]`;
      result.content[0].text = budget.emit(`${result.content[0].text}${guidance}`);
      return result;
    },
  });

  const ls = wrap(
    "ls",
    "List repository directory",
    "List entries below the fixed read-only repository source root.",
    Type.Object({ path: Type.Optional(Type.String({ maxLength: 1024 })) }),
    async ({ path: input = "." }) => {
      const target = safeRelativePath(input);
      const stat = await lstat(target.absolute);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("path is not a repository directory");
      const entries = (await readdir(target.absolute, { withFileTypes: true }))
        .filter((entry) => !entry.isSymbolicLink())
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, limits.maxSearchHits);
      const truncated = entries.length === limits.maxSearchHits;
      const output = entries.map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`).join("\n");
      return textResult(`${output}${truncated ? "\n[truncated: entry limit reached]" : ""}`, { count: entries.length, truncated });
    },
  );

  const find = wrap(
    "find",
    "Find repository files",
    "Find repository file paths by a case-insensitive literal name fragment. No shell or process is executed.",
    Type.Object({ query: Type.Optional(Type.String({ maxLength: 256 })), path: Type.Optional(Type.String({ maxLength: 1024 })) }),
    async ({ query = "", path: input = "." }) => {
      const normalized = query.toLowerCase();
      const files = await walkFiles(input);
      const matches = files.filter((file) => file.relative.toLowerCase().includes(normalized)).slice(0, limits.maxSearchHits);
      const truncated = matches.length === limits.maxSearchHits;
      return textResult(`${matches.map((file) => file.relative).join("\n")}${truncated ? "\n[truncated: search hit limit reached]" : ""}`, { count: matches.length, truncated });
    },
  );

  const grep = wrap(
    "grep",
    "Search repository text",
    "Search UTF-8 repository files for a literal text fragment. Returns paths, line numbers, and citation hashes without running a subprocess.",
    Type.Object({
      query: Type.String({ minLength: 1, maxLength: 256 }),
      path: Type.Optional(Type.String({ maxLength: 1024 })),
      ignoreCase: Type.Optional(Type.Boolean()),
    }),
    async ({ query, path: input = ".", ignoreCase = false }, signal) => {
      const files = await walkFiles(input);
      const needle = ignoreCase ? query.toLowerCase() : query;
      const matches = [];
      for (const file of files) {
        if (signal?.aborted) throw new Error("tool call aborted");
        let source;
        try {
          source = await readFile(file.absolute, "utf8");
        } catch {
          continue;
        }
        const lines = sourceLines(source);
        for (let index = 0; index < lines.length; index += 1) {
          const candidate = ignoreCase ? lines[index].toLowerCase() : lines[index];
          if (!candidate.includes(needle)) continue;
          budget.state.examinedPaths.add(file.relative);
          const display = lines[index].length > 500 ? `${lines[index].slice(0, 500)}…` : lines[index];
          matches.push(`${file.relative}:${index + 1}:${display}\n  contentHash=${sha256(lines[index])}`);
          if (matches.length >= limits.maxSearchHits) break;
        }
        if (matches.length >= limits.maxSearchHits) break;
      }
      const truncated = matches.length === limits.maxSearchHits;
      return textResult(`${matches.join("\n")}${truncated ? "\n[truncated: search hit limit reached]" : ""}`, { count: matches.length, truncated });
    },
  );

  const read = wrap(
    "read",
    "Read repository text",
    "Read a bounded UTF-8 line range from a repository file and return the exact citation hash for that range.",
    Type.Object({
      path: Type.String({ minLength: 1, maxLength: 1024 }),
      lineStart: Type.Optional(Type.Integer({ minimum: 1 })),
      lineCount: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    async ({ path: input, lineStart = 1, lineCount = limits.maxReadLines }) => {
      const file = await requireRegularFile(input);
      const source = await readFile(file.absolute, "utf8");
      const lines = sourceLines(source);
      if (lineStart > lines.length) throw new Error("lineStart is beyond the end of the file");
      const effectiveCount = Math.min(lineCount, limits.maxReadLines);
      const selected = lines.slice(lineStart - 1, lineStart - 1 + effectiveCount);
      let end = selected.length;
      while (end > 1 && Buffer.byteLength(selected.slice(0, end).join("\n"), "utf8") > limits.maxReadBytes) end -= 1;
      const content = selected.slice(0, end).join("\n");
      if (Buffer.byteLength(content, "utf8") > limits.maxReadBytes) {
        budget.state.examinedPaths.add(file.relative);
        return textResult(`path=${file.relative} lineStart=${lineStart} truncated=true citationAvailable=false\n[truncated: first line exceeds the single-read byte limit]`, { path: file.relative, lineStart, truncated: true, citationAvailable: false });
      }
      const lineEnd = lineStart + end - 1;
      const numbered = selected.slice(0, end).map((line, index) => `${lineStart + index}: ${line}`).join("\n");
      const truncated = lineEnd < lines.length;
      const citationRanges = boundedCitationRanges(lines, lineStart, lineEnd);
      const citationSummary = citationRanges.map((range) => `${range.lineStart}-${range.lineEnd}:${range.contentHash}`).join(",");
      budget.state.examinedPaths.add(file.relative);
      return textResult(
        `path=${file.relative} lines=${lineStart}-${lineEnd} citationRanges=${citationSummary}${truncated ? " truncated=true" : ""}\n${numbered}`,
        { path: file.relative, lineStart, lineEnd, citationRanges, truncated },
      );
    },
  );
  const writeWiki = wrap(
    "write_wiki",
    "Write Repository Wiki page",
    "Write one UTF-8 Markdown page below the fixed Wiki output root. This cannot modify repository source files.",
    Type.Object({
      path: Type.String({ minLength: 3, maxLength: 256 }),
      content: Type.String({ minLength: 200, maxLength: MAX_WIKI_PAGE_BYTES }),
    }),
    async ({ path: input, content }) => {
      if (budget.state.examinedPaths.size < limits.minimumExaminedPaths) {
        throw new Error(`inspect ${limits.minimumExaminedPaths - budget.state.examinedPaths.size} more unique representative source paths before writing the Wiki`);
      }
      const missingCitations = missingFactualSectionCitations(content);
      if (missingCitations.length > 0) throw new Error(`factual Wiki sections require [S*] Citation markers: ${missingCitations.join(", ")}`);
      const target = safeWikiPath(input);
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > MAX_WIKI_PAGE_BYTES) throw new Error("Wiki page exceeds its byte limit");
      const previousBytes = budget.state.wikiFiles.get(target.relative) ?? 0;
      if (!budget.state.wikiFiles.has(target.relative) && budget.state.wikiFiles.size >= MAX_WIKI_FILES) throw new Error("Wiki file count limit exceeded");
      const aggregateBytes = [...budget.state.wikiFiles.values()].reduce((sum, value) => sum + value, 0) - previousBytes + bytes;
      if (aggregateBytes > MAX_WIKI_BUNDLE_BYTES) throw new Error("Wiki bundle byte limit exceeded");
      await mkdir(path.dirname(target.absolute), { recursive: true });
      await writeFile(target.absolute, content, { encoding: "utf8", mode: 0o600 });
      budget.state.wikiFiles.set(target.relative, bytes);
      return textResult(`wrote ${target.relative} (${bytes} bytes)`, { path: target.relative, bytes });
    },
  );
  return purpose === "repository_analysis" ? [ls, find, grep, read, writeWiki] : [ls, find, grep, read];
}

async function readControlInput() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let line = "";
  for await (const chunk of rl) {
    line += chunk;
    if (Buffer.byteLength(line, "utf8") > MAX_CONTROL_BYTES) throw new Error("control input exceeds limit");
  }
  const input = JSON.parse(line);
  const requiredStrings = ["purpose", "baseUrl", "apiKey", "model", "thinking", "skillName", "prompt", "promptVersion", "commitSha"];
  if (requiredStrings.some((key) => typeof input[key] !== "string" || input[key].length === 0)) throw new Error("control input is invalid");
  if (!['repository_analysis', 'conversation_analysis'].includes(input.purpose)) throw new Error("control purpose is invalid");
  if (!['repository-analysis', 'code-question-answering'].includes(input.skillName)) throw new Error("control skill is invalid");
  const numeric = ["eligibleFileCount", "maxRounds", "maxToolCalls", "maxAggregateToolOutputBytes", "maxReadBytes", "maxReadLines", "maxSearchHits", "maxTokens", "contextWindow"];
  if (numeric.some((key) => !Number.isInteger(input[key]) || input[key] < 1)) throw new Error("control budget is invalid");
  if (!Number.isInteger(input.minimumExaminedPaths) || input.minimumExaminedPaths < 0 || input.minimumExaminedPaths > input.eligibleFileCount) throw new Error("control coverage target is invalid");
  return input;
}

function normalizeDossier(result, input, examinedPaths) {
  const paths = [...examinedPaths].sort();
  return {
    title: result?.title,
    summary: result?.summary,
    pages: Array.isArray(result?.pages) ? result.pages : [],
    citations: Array.isArray(result?.citations) ? result.citations : [],
    coverage: {
      analysisMode: result?.coverage?.analysisMode === "broad" ? "broad" : "targeted",
      eligibleFileCount: input.eligibleFileCount,
      examinedFileCount: paths.length,
      examinedPaths: paths,
      coveredAreas: Array.isArray(result?.coverage?.coveredAreas) ? result.coverage.coveredAreas : [],
      skipped: [{ reason: "scope", count: input.eligibleFileCount - paths.length }],
    },
  };
}

async function main() {
  const input = await readControlInput();
  guestStage = "model";
  const credentials = new InMemoryCredentialStore();
  const modelsStore = new InMemoryModelsStore();
  const modelRuntime = await ModelRuntime.create({ credentials, modelsStore, modelsPath: null, refreshOnCreate: false });
  const deepSeekCompatible = /^deepseek-/i.test(input.model);
  const providerId = deepSeekCompatible ? "deepseek" : "askme-runtime";
  modelRuntime.registerProvider(providerId, {
    name: "Askme runtime provider",
    baseUrl: input.baseUrl,
    api: "openai-completions",
    authHeader: true,
    models: [{
      id: input.model,
      name: input.model,
      api: "openai-completions",
      reasoning: input.thinking !== "off",
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: input.contextWindow,
      maxTokens: input.maxTokens,
      ...(deepSeekCompatible ? { samplingParams: {
        thinking: { type: input.thinking === "off" ? "disabled" : "enabled" },
        ...(input.thinking === "off" ? {} : { reasoning_effort: input.thinking }),
      } } : {}),
      compat: {
        maxTokensField: "max_tokens",
        ...(deepSeekCompatible ? {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
          requiresReasoningContentOnAssistantMessages: true,
          thinkingFormat: "deepseek",
        } : {}),
      },
      ...(deepSeekCompatible ? { thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" } } : {}),
    }],
  });
  await modelRuntime.setRuntimeApiKey(providerId, input.apiKey);
  const model = modelRuntime.getModel(providerId, input.model);
  if (!model) throw new Error("configured model is unavailable");

  const skillPath = path.join(SKILLS_ROOT, input.skillName, "SKILL.md");
  guestStage = "resources";
  const resourceLoader = new DefaultResourceLoader({
    cwd: SOURCE_ROOT,
    agentDir: "/opt/askme-code-agent/no-global-resources",
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalSkillPaths: [skillPath],
    skillsOverride: (base) => ({ skills: base.skills.filter((skill) => skill.filePath === skillPath), diagnostics: base.diagnostics }),
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    appendSystemPromptOverride: () => [],
  });
  await resourceLoader.reload();
  const loadedSkills = resourceLoader.getSkills().skills;
  if (loadedSkills.length !== 1 || loadedSkills[0].name !== input.skillName) throw new Error("product skill isolation failed");

  const budget = createBudget(input);
  let lockSourceTools = () => {};
  const customTools = createTools(budget, input, input.purpose, () => lockSourceTools());
  const authorizedTools = input.purpose === "repository_analysis" ? ["ls", "find", "grep", "read", "write_wiki"] : ["ls", "find", "grep", "read"];
  guestStage = "session";
  const { session } = await createAgentSession({
    cwd: SOURCE_ROOT,
    agentDir: "/opt/askme-code-agent/no-global-resources",
    modelRuntime,
    model,
    thinkingLevel: input.thinking,
    noTools: "all",
    tools: authorizedTools,
    customTools,
    resourceLoader,
    sessionManager: SessionManager.inMemory(SOURCE_ROOT),
    settingsManager: SettingsManager.inMemory({ enableSkillCommands: true, retry: { enabled: false } }),
  });
  lockSourceTools = () => session.setActiveToolsByName(["write_wiki"]);
  const activeTools = session.getActiveToolNames().sort();
  const expectedTools = input.purpose === "repository_analysis" ? "find,grep,ls,read,write_wiki" : "find,grep,ls,read";
  if (activeTools.join(",") !== expectedTools) throw new Error("tool isolation failed");

  const unsubscribe = session.subscribe((event) => {
    if (event.type !== "turn_start") return;
    budget.state.rounds += 1;
    if (budget.state.rounds > input.maxRounds) {
      budget.state.exhausted = "rounds";
      queueMicrotask(() => void session.abort());
    }
  });
  try {
    guestStage = "prompt";
    try {
      await session.prompt(`/skill:${input.skillName} ${input.prompt}`, { expandPromptTemplates: true, source: "rpc" });
      await session.waitForIdle();
    } catch (error) {
      const message = error && typeof error === "object" && typeof error.message === "string" ? error.message : "";
      const name = error && typeof error === "object" && typeof error.name === "string" ? error.name : error?.constructor?.name;
      const safeName = typeof name === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name.toUpperCase() : "UNKNOWN";
      ({ code: guestCode, name: guestName } = classifyModelError(message, safeName));
      throw error;
    }
    if (budget.state.exhausted) {
      guestCode = "REQUEST";
      guestName = `BUDGET${budget.state.exhausted.replaceAll("_", "").toUpperCase()}`;
      throw new Error(`analysis budget exhausted: ${budget.state.exhausted}`);
    }
    const assistants = session.messages.filter((message) => message.role === "assistant");
    const terminal = assistants.at(-1);
    if (!terminal) {
      guestCode = "REQUEST";
      guestName = "NOFINAL";
      throw new Error("model did not produce a completed result");
    }
    if (terminal.stopReason === "error" || terminal.stopReason === "aborted") {
      const message = typeof terminal.errorMessage === "string" ? terminal.errorMessage : "";
      ({ code: guestCode, name: guestName } = classifyModelError(message, terminal.stopReason === "error" ? "STOPERROR" : "ABORTED"));
      throw new Error("model did not produce a completed result");
    }
    const selected = selectFinalAssistantText(assistants);
    const final = selected?.message ?? terminal;
    const finalText = selected?.text ?? "";
    guestStage = "output";
    let parsed;
    try {
      parsed = parseFinalJson(finalText);
    } catch (error) {
      guestCode = "OUTPUT";
      guestName = final.stopReason === "length" ? "MAXTOKENS" : finalText.trim().length === 0 ? "EMPTY" : "INVALIDJSON";
      throw error;
    }
    const result = input.purpose === "repository_analysis"
      ? normalizeDossier(parsed, input, budget.state.examinedPaths)
      : parsed;
    const stats = session.getSessionStats();
    process.stdout.write(`${JSON.stringify({
      protocolVersion: 1,
      purpose: input.purpose,
      result,
      usage: {
        inputTokens: stats.tokens.input,
        outputTokens: stats.tokens.output,
        totalTokens: stats.tokens.total,
        rounds: budget.state.rounds,
        toolCalls: budget.state.toolCalls,
        aggregateToolOutputBytes: budget.state.aggregateOutputBytes,
        examinedFileCount: budget.state.examinedPaths.size,
        truncatedToolOutputs: budget.state.truncatedToolOutputs,
      },
      provenance: {
        actualModel: final.responseModel ?? final.model,
        skillName: input.skillName,
        activeTools,
        loadedSkills: loadedSkills.map((skill) => skill.name),
        promptVersion: input.promptVersion,
        commitSha: input.commitSha,
      },
    })}\n`);
  } finally {
    unsubscribe();
    session.dispose();
    await modelRuntime.removeRuntimeApiKey(providerId).catch(() => {});
  }
}

main().catch((error) => {
  void error;
  process.stderr.write(`CODE_AGENT_GUEST_FAILURE:${guestStage}:${guestCode}:${guestName}\n`);
  process.exitCode = 1;
});
