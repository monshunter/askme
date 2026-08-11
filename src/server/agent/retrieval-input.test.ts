import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { buildEvidenceSearchQuery, parseEvidenceQuery } from "./retrieval-input";

describe("Agent evidence retrieval input", () => {
  it("normalizes bounded questions and result limits", () => {
    expect(parseEvidenceQuery({ query: "  Kubernetes   operator  ", limit: 6 })).toEqual({ query: "Kubernetes operator", limit: 6 });
    expect(parseEvidenceQuery({ query: "AI Agent" })).toEqual({ query: "AI Agent", limit: 8 });
  });

  it("removes question boilerplate and builds a recall-oriented lexical query", () => {
    expect(buildEvidenceSearchQuery("What did you build in Inkstone Career Agent?")).toBe("build OR Inkstone OR Career OR Agent");
    expect(buildEvidenceSearchQuery("What evidence supports that impact?")).toBe("evidence OR supports OR impact");
  });

  it("rejects empty, oversized, and unbounded retrieval requests", () => {
    for (const input of [{ query: "" }, { query: "%%%" }, { query: "x".repeat(501) }, { query: "Agent", limit: 0 }, { query: "Agent", limit: 21 }]) {
      expect(() => parseEvidenceQuery(input)).toThrowError(expect.objectContaining({ code: "INVALID_EVIDENCE_QUERY" }) as Partial<AppError>);
    }
  });
});
