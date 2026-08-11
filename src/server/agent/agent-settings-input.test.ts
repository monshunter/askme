import { describe, expect, it } from "vitest";

import { parseAgentSettingsPatch } from "./agent-settings-input";
import { buildSuggestedQuestions, buildSuggestedQuestionsAtOffset } from "./suggested-questions";

describe("parseAgentSettingsPatch", () => {
  it("accepts a strict non-empty partial settings update", () => {
    expect(parseAgentSettingsPatch({ answerTone: "concise", publicMode: true })).toEqual({ answerTone: "concise", publicMode: true });
    expect(parseAgentSettingsPatch({ privacySafeMode: false })).toEqual({ privacySafeMode: false });
  });

  it("rejects empty, unknown, or invalid settings", () => {
    for (const input of [{}, { answerTone: "verbose" }, { publicMode: "yes" }, { answerTone: "professional", extra: true }]) {
      expect(() => parseAgentSettingsPatch(input)).toThrowError(expect.objectContaining({ code: "INVALID_AGENT_SETTINGS" }));
    }
  });
});

describe("buildSuggestedQuestions", () => {
  const items = [
    { type: "project" as const, title: "Atlas Career Agent" },
    { type: "skill" as const, title: "Retrieval evaluation" },
  ];

  it("derives bounded questions from current knowledge facts", () => {
    const questions = buildSuggestedQuestions(items, []);
    expect(questions).toHaveLength(4);
    expect(questions[0]).toBe("What did you build in Atlas Career Agent?");
    expect(questions.some((question) => question.includes("Retrieval evaluation"))).toBe(true);
    expect(new Set(questions).size).toBe(questions.length);
  });

  it("rotates the next refresh without inventing new owner facts", () => {
    const first = buildSuggestedQuestions(items, []);
    const refreshed = buildSuggestedQuestions(items, first);
    expect(refreshed).not.toEqual(first);
    expect(refreshed).toHaveLength(4);
  });

  it("supports a persistent public-session rotation cursor", () => {
    expect(buildSuggestedQuestionsAtOffset(items, 1)).toEqual(buildSuggestedQuestions(items, buildSuggestedQuestionsAtOffset(items, 0)));
  });

  it("never pads one evidence-backed item with generic questions", () => {
    const questions = buildSuggestedQuestions([{ type: "project", title: "Inkstone Career Agent" }], []);
    expect(questions).toHaveLength(4);
    expect(questions.every((question) => question.includes("Inkstone Career Agent"))).toBe(true);
  });

  it("returns no suggestions when there is no evidence-backed knowledge", () => {
    expect(buildSuggestedQuestions([], [])).toEqual([]);
  });
});
