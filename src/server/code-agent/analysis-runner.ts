import type { Pool } from "pg";

import type { RuntimeConfig } from "@/server/config";
import { AppError, toAppError } from "@/server/errors";
import { readRepositoryArtifactEvidence } from "@/server/repositories/artifact-reader";
import { parseRepositoryDossierOutput, validateRepositoryDossierOutput } from "@/server/repositories/dossier-output";
import { completeRepositoryAnalysisRun } from "@/server/repositories/dossier-service";

import { codeAnswerResultSchema } from "./contracts";
import { completeConversationAnalysisRun, validateConversationAnalysisEnvelope } from "./conversation-analysis-service";
import { failAnalysisRun, recordAnalysisMicrovm, renewAnalysisLease, type AnalysisRunLease } from "./analysis-leases";
import { codeAgentProfileFingerprint, codeAgentSkillHash } from "./provenance";
import { BoxliteCodeAgentSandbox } from "./sandbox/boxlite-sandbox";

function cleanupTimestamp(error: AppError) {
  const value = error.details?.cleanupCompletedAt;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

async function requireCurrentProvenance(config: RuntimeConfig, lease: AnalysisRunLease) {
  if (config.codeAgent.imageDigest !== lease.imageDigest) throw new AppError("CODE_AGENT_PROVENANCE_CHANGED", "The queued Code Agent image provenance is no longer current.", 409);
  const currentSkillHash = await codeAgentSkillHash(lease.purpose);
  const currentFingerprint = codeAgentProfileFingerprint(config.ai.profiles.code, lease.budget, config.codeAgent);
  if (currentSkillHash !== lease.skillHash || currentFingerprint !== lease.profileFingerprint || config.codeAgent.promptVersion !== lease.promptVersion) {
    throw new AppError("CODE_AGENT_PROVENANCE_CHANGED", "The queued Code Agent runtime provenance is no longer current.", 409);
  }
}

function repositoryPrompt(lease: AnalysisRunLease) {
  return [
    `Analyze Repository ${JSON.stringify(lease.repositoryDisplayName)} at immutable commit ${lease.commitSha}.`,
    `The Artifact contains exactly ${lease.fileCount} eligible UTF-8 files.`,
    `Repository visibility is ${lease.repositoryVisibility}.`,
    "Generate a DeepWiki-style Repository Wiki as one or more linked Markdown pages according to the repository's real content. Write the pages with write_wiki, return only their manifest and exact source Citations, cover the major system boundaries, and state material uncertainty or unexamined areas honestly.",
  ].join("\n");
}

function conversationPrompt(lease: AnalysisRunLease) {
  if (!lease.userQuestion) throw new AppError("CONVERSATION_ANALYSIS_CONTEXT_INVALID", "The deep analysis question is unavailable.", 500);
  return [
    `Answer this one question about Repository ${JSON.stringify(lease.repositoryDisplayName)} at immutable commit ${lease.commitSha}:`,
    lease.userQuestion,
    "Use only exact source reads from this Revision. Return answered only when every factual statement is supported by the returned Citations; otherwise return insufficient or refused.",
  ].join("\n");
}

export async function processAnalysisLease(input: {
  pool: Pool;
  config: RuntimeConfig;
  sandbox: BoxliteCodeAgentSandbox;
  lease: AnalysisRunLease;
}) {
  const { pool, config, sandbox, lease } = input;
  const abortController = new AbortController();
  let heartbeatError: AppError | null = null;
  let heartbeatBusy = false;
  let microvmCreated = false;
  let cleanupConfirmedAt: Date | null = lease.staleMicrovmId ? null : new Date();
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    void renewAnalysisLease(pool, lease, config.codeAgent.leaseMs)
      .then(({ cancelRequested }) => {
        if (cancelRequested) abortController.abort();
      })
      .catch((error) => {
        heartbeatError = toAppError(error);
        abortController.abort();
      })
      .finally(() => {
        heartbeatBusy = false;
      });
  }, config.codeAgent.heartbeatMs);
  heartbeat.unref?.();

  try {
    await requireCurrentProvenance(config, lease);
    if (lease.staleMicrovmId) {
      await sandbox.removeStaleMicrovm(lease.staleMicrovmId);
      cleanupConfirmedAt = new Date();
    }
    if (lease.cancelRequested) {
      throw new AppError("CODE_AGENT_CANCELLED", "The Code Agent run was cancelled.", 409, { cleanupCompletedAt: cleanupConfirmedAt!.toISOString() });
    }
    if (!config.ai.apiKey) throw new AppError("CODE_AGENT_AI_UNAVAILABLE", "The Code Agent AI credential is not configured.", 503);
    const isConversation = lease.purpose === "conversation_analysis";
    const result = await sandbox.run({
      runId: lease.runId,
      purpose: lease.purpose,
      prompt: isConversation ? conversationPrompt(lease) : repositoryPrompt(lease),
      skillName: isConversation ? "code-question-answering" : "repository-analysis",
      promptVersion: lease.promptVersion,
      artifactRoot: config.repositoryArtifactRoot,
      artifact: lease,
      eligibleFileCount: lease.fileCount,
      profile: config.ai.profiles.code,
      aiBaseUrl: config.ai.baseUrl,
      aiApiKey: config.ai.apiKey,
      budget: lease.budget,
      signal: abortController.signal,
      onCreated: async (microvmId) => {
        microvmCreated = true;
        cleanupConfirmedAt = null;
        await recordAnalysisMicrovm(pool, lease, microvmId);
      },
      validateEnvelope: async (envelope, wikiFiles) => {
        if (isConversation) {
          await validateConversationAnalysisEnvelope({ artifactRoot: config.repositoryArtifactRoot, artifact: lease, result: envelope.result });
          return;
        }
        const parsed = parseRepositoryDossierOutput(envelope.result);
        const evidence = await readRepositoryArtifactEvidence(config.repositoryArtifactRoot, lease, parsed.coverage.examinedPaths);
        validateRepositoryDossierOutput(parsed, wikiFiles, evidence, lease.repositoryVisibility);
      },
      correctionPrompt: (errorCode, previous) => [
        `Your previous ${isConversation ? "answer" : "Repository Wiki bundle"} failed deterministic Host validation with code ${errorCode}.`,
        `Re-read the exact cited ranges${isConversation ? "" : ", audit every ## section so each factual section contains a defined [S*] marker, use only a read citationRanges entry of at most 200 lines, rewrite every declared Markdown page with write_wiki,"} and return one fully corrected JSON object. Do not discuss the error or preserve unsupported statements within the remaining budget.`,
        ...(!isConversation ? [`Previous control manifest (not trusted; correct it as needed): ${JSON.stringify(previous.result).slice(0, 24_000)}`] : []),
      ].join("\n"),
    });
    cleanupConfirmedAt = result.cleanupCompletedAt;
    if (heartbeatError) throw heartbeatError;
    if (abortController.signal.aborted) throw new AppError("CODE_AGENT_CANCELLED", "The Code Agent run was cancelled.", 409, { cleanupCompletedAt: result.cleanupCompletedAt.toISOString() });
    if (isConversation && !codeAnswerResultSchema.safeParse(result.envelope.result).success) {
      throw new AppError("CODE_ANSWER_OUTPUT_INVALID", "The deep analysis answer does not match its required schema.", 422, { cleanupCompletedAt: result.cleanupCompletedAt.toISOString() });
    }
    const completion = isConversation
      ? await completeConversationAnalysisRun({
          pool, artifactRoot: config.repositoryArtifactRoot, artifact: lease, runId: lease.runId, leaseOwner: lease.leaseOwner,
          output: result.envelope.result, actualModel: result.envelope.provenance.actualModel, usage: result.envelope.usage,
          cleanupCompletedAt: result.cleanupCompletedAt,
        })
      : await completeRepositoryAnalysisRun({
          pool, artifactRoot: config.repositoryArtifactRoot, runId: lease.runId, leaseOwner: lease.leaseOwner,
          output: result.envelope.result, wikiFiles: result.wikiFiles, actualModel: result.envelope.provenance.actualModel, usage: result.envelope.usage,
          cleanupCompletedAt: result.cleanupCompletedAt,
        });
    return { purpose: lease.purpose, runId: lease.runId, microvmId: result.microvmId, ...completion, usage: result.envelope.usage };
  } catch (error) {
    const safe = toAppError(error);
    const cancelled = safe.code === "CODE_AGENT_CANCELLED" || abortController.signal.aborted;
    const cleanupCompletedAt = safe.code === "CODE_AGENT_CLEANUP_FAILED" || safe.code === "CODE_AGENT_CLEANUP_TIMEOUT"
      ? null
      : cleanupTimestamp(safe) ?? cleanupConfirmedAt ?? (!microvmCreated && !lease.staleMicrovmId ? new Date() : null);
    await failAnalysisRun(pool, lease, { errorCode: cancelled ? "CODE_AGENT_CANCELLED" : safe.code, cancelled, cleanupCompletedAt });
    throw safe;
  } finally {
    clearInterval(heartbeat);
  }
}
