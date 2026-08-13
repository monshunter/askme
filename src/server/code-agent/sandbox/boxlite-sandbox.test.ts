import { describe, expect, it } from "vitest";

import { classifyGuestFailure, reachedAnalysisDeadline } from "./boxlite-sandbox";

describe("Code Agent guest failure classification", () => {
  it("preserves the bounded guest stage, category, and error name", () => {
    expect(classifyGuestFailure("CODE_AGENT_GUEST_FAILURE:prompt:MODEL:APIERROR\n")).toBe(
      "CODE_AGENT_GUEST_PROMPT_MODEL_APIERROR_FAILED",
    );
  });

  it("projects unclassified network and runtime failures to stable safe codes", () => {
    expect(classifyGuestFailure("TypeError: fetch failed")).toBe("CODE_AGENT_AI_UPSTREAM_UNREACHABLE");
    expect(classifyGuestFailure("unexpected guest failure")).toBe("CODE_AGENT_GUEST_FAILED");
  });

  it("preserves safe final-output classifications without exposing model text", () => {
    expect(classifyGuestFailure("CODE_AGENT_GUEST_FAILURE:output:OUTPUT:MAXTOKENS\n")).toBe(
      "CODE_AGENT_GUEST_OUTPUT_OUTPUT_MAXTOKENS_FAILED",
    );
    expect(classifyGuestFailure("CODE_AGENT_GUEST_FAILURE:output:OUTPUT:INVALIDJSON\n")).toBe(
      "CODE_AGENT_GUEST_OUTPUT_OUTPUT_INVALIDJSON_FAILED",
    );
  });
});

describe("Code Agent analysis deadline classification", () => {
  it("allows scheduler jitter while distinguishing early guest failures", () => {
    expect(reachedAnalysisDeadline(1_000, 600_000, 600_000)).toBe(true);
    expect(reachedAnalysisDeadline(1_000, 599_999, 600_000)).toBe(false);
  });
});
