import { z } from "zod";

import type { CodeAgentBudget } from "@/server/config";
import { AppError } from "@/server/errors";

const citation = z.object({
  path: z.string().trim().min(1).max(1_024),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const codeAnswerResultSchema = z.object({
  outcome: z.enum(["answered", "insufficient", "refused"]),
  answerMarkdown: z.string().trim().min(1).max(32_000),
  citations: z.array(citation).max(100),
}).strict().superRefine((result, context) => {
  if (result.outcome === "answered" && (!result.answerMarkdown || result.citations.length === 0)) {
    context.addIssue({ code: "custom", message: "An answered code result requires an answer and at least one Citation." });
  }
  if (result.outcome !== "answered" && result.citations.length > 0) {
    context.addIssue({ code: "custom", message: "A non-answered code result cannot expose Citations." });
  }
});

const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  rounds: z.number().int().positive(),
  toolCalls: z.number().int().nonnegative(),
  aggregateToolOutputBytes: z.number().int().nonnegative(),
  examinedFileCount: z.number().int().nonnegative(),
  truncatedToolOutputs: z.number().int().nonnegative(),
}).strict();

const provenanceSchema = z.object({
  actualModel: z.string().trim().min(1).max(300),
  skillName: z.enum(["repository-analysis", "code-question-answering"]),
  activeTools: z.array(z.string()).min(4).max(5),
  loadedSkills: z.array(z.string()).length(1),
  promptVersion: z.string().trim().min(1).max(200),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
}).strict();

const envelopeSchema = z.object({
  protocolVersion: z.literal(1),
  purpose: z.enum(["repository_analysis", "conversation_analysis"]),
  result: z.unknown(),
  usage: usageSchema,
  provenance: provenanceSchema,
}).strict();

export type GuestCodeAgentEnvelope = z.infer<typeof envelopeSchema>;
export type CodeAnswerResult = z.infer<typeof codeAnswerResultSchema>;

export function parseGuestCodeAgentEnvelope(input: unknown, expected: {
  purpose: "repository_analysis" | "conversation_analysis";
  commitSha: string;
  skillName: "repository-analysis" | "code-question-answering";
  promptVersion: string;
  configuredModel: string;
  maxTokens: number;
  budget: CodeAgentBudget;
}) {
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) throw new AppError("CODE_AGENT_RESULT_INVALID", "The Code Agent returned an invalid structured result.", 502);
  const envelope = parsed.data;
  const expectedTools = expected.purpose === "repository_analysis" ? "find,grep,ls,read,write_wiki" : "find,grep,ls,read";
  if (
    envelope.purpose !== expected.purpose
    || envelope.provenance.commitSha !== expected.commitSha
    || envelope.provenance.skillName !== expected.skillName
    || envelope.provenance.promptVersion !== expected.promptVersion
    || envelope.provenance.loadedSkills[0] !== expected.skillName
    || [...envelope.provenance.activeTools].sort().join(",") !== expectedTools
    || envelope.usage.rounds > expected.budget.maxRounds
    || envelope.usage.toolCalls > expected.budget.maxToolCalls
    || envelope.usage.aggregateToolOutputBytes > expected.budget.maxAggregateToolOutputBytes
  ) {
    throw new AppError("CODE_AGENT_RESULT_PROVENANCE_INVALID", "The Code Agent result does not match its authorized run context.", 502);
  }
  if (envelope.usage.outputTokens > expected.maxTokens) {
    throw new AppError("CODE_AGENT_RESULT_BUDGET_INVALID", "The Code Agent result exceeded its token budget.", 502);
  }
  if (expected.purpose === "conversation_analysis") {
    const answer = codeAnswerResultSchema.safeParse(envelope.result);
    if (!answer.success) throw new AppError("CODE_AGENT_RESULT_INVALID", "The Code Agent answer does not match the required schema.", 502);
    return { ...envelope, result: answer.data };
  }
  if (envelope.provenance.actualModel.length === 0 || expected.configuredModel.length === 0) {
    throw new AppError("CODE_AGENT_RESULT_PROVENANCE_INVALID", "The Code Agent model provenance is invalid.", 502);
  }
  return envelope;
}
