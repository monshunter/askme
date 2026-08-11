import { describe, expect, it } from "vitest";

import { publicAnswerRisk } from "./public-risk";

describe("public answer risk projection", () => {
  it("maps safety refusals and missing citations without storing question text", () => {
    expect(publicAnswerRisk("refused", "QUESTION_INJECTION", 0)).toEqual({
      category: "prompt_injection",
      severity: "medium",
      safeSummary: "A public question was rejected because it attempted to change or reveal Agent instructions.",
    });
    expect(publicAnswerRisk("insufficient_evidence", "INSUFFICIENT_EVIDENCE", 0)?.category).toBe("missing_citation");
    expect(publicAnswerRisk("answered", null, 2)).toBeNull();
  });
});
