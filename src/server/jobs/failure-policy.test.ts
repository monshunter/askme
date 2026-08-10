import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { ingestionFailureDecision } from "./failure-policy";

describe("ingestion failure policy", () => {
  it("fails terminal input and configuration errors immediately", () => {
    expect(ingestionFailureDecision(new AppError("MATERIAL_PDF_INVALID", "The PDF could not be read.", 422), 1, 3)).toEqual({
      code: "MATERIAL_PDF_INVALID",
      message: "The PDF could not be read.",
      outcome: "failed",
      backoffSeconds: null,
    });
    expect(ingestionFailureDecision(new AppError("AI_NOT_CONFIGURED", "The AI provider is not configured.", 503), 1, 3).outcome).toBe("failed");
    expect(ingestionFailureDecision(new AppError("NO_CAREER_KNOWLEDGE", "No career-relevant knowledge could be grounded.", 422), 1, 3).outcome).toBe("failed");
  });

  it("backs off recoverable provider failures until max attempts", () => {
    expect(ingestionFailureDecision(new AppError("AI_RATE_LIMITED", "The AI provider is temporarily rate limited.", 503), 1, 3)).toMatchObject({
      outcome: "retry_scheduled",
      backoffSeconds: 15,
    });
    expect(ingestionFailureDecision(new AppError("AI_TIMEOUT", "The AI provider did not respond in time.", 504), 2, 3)).toMatchObject({
      outcome: "retry_scheduled",
      backoffSeconds: 30,
    });
    expect(ingestionFailureDecision(new AppError("AI_TIMEOUT", "The AI provider did not respond in time.", 504), 3, 3)).toMatchObject({
      outcome: "failed",
      backoffSeconds: null,
    });
    expect(ingestionFailureDecision(new AppError("AI_ORGANIZATION_INVALID", "The AI organization is invalid.", 502), 1, 3)).toMatchObject({
      outcome: "retry_scheduled",
      backoffSeconds: 15,
    });
  });

  it("maps unknown exceptions to a safe retriable internal error", () => {
    expect(ingestionFailureDecision(new Error("private raw payload"), 1, 3)).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      outcome: "retry_scheduled",
      backoffSeconds: 15,
    });
  });
});
