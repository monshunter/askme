import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AiProfile, CodeAgentBudget, RuntimeConfig } from "@/server/config";
import { AppError } from "@/server/errors";

export type CodeAgentPurpose = "repository_analysis" | "conversation_analysis";

export function skillNameForPurpose(purpose: CodeAgentPurpose) {
  return purpose === "repository_analysis" ? "repository-analysis" as const : "code-question-answering" as const;
}

export async function codeAgentSkillHash(purpose: CodeAgentPurpose) {
  const file = path.join(process.cwd(), "src/server/code-agent/skills", skillNameForPurpose(purpose), "SKILL.md");
  let content: Buffer;
  try {
    content = await readFile(file);
  } catch {
    throw new AppError("CODE_AGENT_SKILL_UNAVAILABLE", "The Code Agent product Skill is unavailable.", 503);
  }
  return createHash("sha256").update(content).digest("hex");
}

export function codeAgentProfileFingerprint(profile: AiProfile, budget: CodeAgentBudget, config: RuntimeConfig["codeAgent"]) {
  return createHash("sha256").update(JSON.stringify({
    model: profile.model,
    thinking: profile.thinking,
    timeoutMs: profile.timeoutMs,
    maxRetries: profile.maxRetries,
    maxTokens: profile.maxTokens,
    contextWindow: profile.contextWindow,
    budget: {
      analysisTimeoutMs: budget.analysisTimeoutMs,
      maxRounds: budget.maxRounds,
      maxToolCalls: budget.maxToolCalls,
      maxAggregateToolOutputBytes: budget.maxAggregateToolOutputBytes,
      maxReadBytes: budget.maxReadBytes,
      maxReadLines: budget.maxReadLines,
      maxSearchHits: budget.maxSearchHits,
    },
    cpus: config.cpus,
    memoryMib: config.memoryMib,
    diskSizeGb: config.diskSizeGb,
  })).digest("hex");
}

export function requireCodeAgentImageDigest(config: RuntimeConfig["codeAgent"]) {
  if (!config.imageDigest) throw new AppError("CODE_AGENT_UNAVAILABLE", "Repository analysis is unavailable because the Code Agent image is not pinned.", 503);
  return config.imageDigest;
}
