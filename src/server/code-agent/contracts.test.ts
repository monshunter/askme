import { describe, expect, it } from "vitest";

import { parseGuestCodeAgentEnvelope } from "./contracts";

const expected = {
  purpose: "conversation_analysis" as const,
  commitSha: "a".repeat(40),
  skillName: "code-question-answering" as const,
  promptVersion: "code-question-v1",
  configuredModel: "deepseek-v4-pro",
  maxTokens: 4_000,
  budget: {
    analysisTimeoutMs: 120_000,
    maxRounds: 10,
    maxToolCalls: 40,
    maxAggregateToolOutputBytes: 1024 * 1024,
    maxReadBytes: 64 * 1024,
    maxReadLines: 500,
    maxSearchHits: 200,
  },
};

function envelope() {
  return {
    protocolVersion: 1,
    purpose: "conversation_analysis",
    result: {
      outcome: "answered",
      answerMarkdown: "The entrypoint exports the handler.",
      citations: [{ path: "src/index.ts", lineStart: 1, lineEnd: 1, contentHash: "b".repeat(64) }],
    },
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, rounds: 2, toolCalls: 3, aggregateToolOutputBytes: 2_000, examinedFileCount: 1, truncatedToolOutputs: 0 },
    provenance: {
      actualModel: "deepseek-v4-pro",
      skillName: "code-question-answering",
      activeTools: ["read", "ls", "grep", "find"],
      loadedSkills: ["code-question-answering"],
      promptVersion: "code-question-v1",
      commitSha: "a".repeat(40),
    },
  };
}

describe("Code Agent guest result contract", () => {
  it("accepts an exact read-only runtime result", () => {
    expect(parseGuestCodeAgentEnvelope(envelope(), expected).result).toMatchObject({ outcome: "answered" });
  });

  it("rejects tool, provenance, and budget escalation", () => {
    const toolEscalation = envelope();
    toolEscalation.provenance.activeTools = ["read", "ls", "grep", "bash"];
    expect(() => parseGuestCodeAgentEnvelope(toolEscalation, expected)).toThrow("authorized run context");

    const budgetEscalation = envelope();
    budgetEscalation.usage.toolCalls = 41;
    expect(() => parseGuestCodeAgentEnvelope(budgetEscalation, expected)).toThrow("authorized run context");

    const revisionEscalation = envelope();
    revisionEscalation.provenance.commitSha = "c".repeat(40);
    expect(() => parseGuestCodeAgentEnvelope(revisionEscalation, expected)).toThrow("authorized run context");
  });

  it("requires the restricted Wiki writer only for repository analysis", () => {
    const repositoryEnvelope = envelope();
    repositoryEnvelope.purpose = "repository_analysis";
    repositoryEnvelope.provenance.skillName = "repository-analysis";
    repositoryEnvelope.provenance.loadedSkills = ["repository-analysis"];
    repositoryEnvelope.provenance.activeTools = ["read", "ls", "grep", "find", "write_wiki"];
    expect(parseGuestCodeAgentEnvelope(repositoryEnvelope, {
      ...expected,
      purpose: "repository_analysis",
      skillName: "repository-analysis",
    }).purpose).toBe("repository_analysis");

    repositoryEnvelope.provenance.activeTools = ["read", "ls", "grep", "find"];
    expect(() => parseGuestCodeAgentEnvelope(repositoryEnvelope, {
      ...expected,
      purpose: "repository_analysis",
      skillName: "repository-analysis",
    })).toThrow("authorized run context");
  });

});
