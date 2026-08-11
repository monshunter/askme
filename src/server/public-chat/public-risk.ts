type PublicAnswerOutcome = "answered" | "refused" | "insufficient_evidence";

export function publicAnswerRisk(outcome: PublicAnswerOutcome, errorCode: string | null, citationCount: number) {
  if (errorCode === "QUESTION_INJECTION") {
    return {
      category: "prompt_injection",
      severity: "medium" as const,
      safeSummary: "A public question was rejected because it attempted to change or reveal Agent instructions.",
    };
  }
  if (errorCode === "QUESTION_DATA_EXFILTRATION") {
    return {
      category: "private_data_request",
      severity: "high" as const,
      safeSummary: "A public question was rejected because it requested secrets, private data, or a bulk export.",
    };
  }
  if (outcome === "insufficient_evidence" || (outcome === "answered" && citationCount === 0)) {
    return {
      category: "missing_citation",
      severity: "medium" as const,
      safeSummary: "A public Agent response completed without authorized supporting citations.",
    };
  }
  return null;
}
