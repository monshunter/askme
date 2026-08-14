import { describe, expect, it } from "vitest";

import { parseChangePasswordInput, parseForgotPasswordInput, parseRegistrationInput, parseResetPasswordInput } from "./auth-input";

describe("Candidate authentication input", () => {
  it("normalizes registration identity without accepting a role", () => {
    expect(parseRegistrationInput({ email: "  CANDIDATE@Example.COM ", displayName: "  Riley Chen  ", password: "Candidate-pass-2026!", role: "admin" })).toEqual({
      email: "candidate@example.com",
      displayName: "Riley Chen",
      password: "Candidate-pass-2026!",
    });
  });

  it("uses one password boundary across registration, reset and change", () => {
    expect(() => parseRegistrationInput({ email: "candidate@example.com", displayName: "Riley", password: "short" })).toThrow();
    expect(() => parseResetPasswordInput({ token: "a".repeat(43), password: "short" })).toThrow();
    expect(() => parseChangePasswordInput({ currentPassword: "Candidate-pass-2026!", newPassword: "short" })).toThrow();
    expect(() => parseRegistrationInput({ email: "candidate@example.com", displayName: "Riley", password: "Candidate-pass-2026!", confirmPassword: "Different-pass-2026!" })).toThrow();
  });

  it("accepts only normalized email and a high-entropy reset token", () => {
    expect(parseForgotPasswordInput({ email: " Riley@Example.com " })).toEqual({ email: "riley@example.com" });
    expect(parseResetPasswordInput({ token: "a".repeat(43), password: "Replacement-pass-2026!" })).toEqual({
      token: "a".repeat(43),
      password: "Replacement-pass-2026!",
    });
    expect(() => parseResetPasswordInput({ token: "predictable", password: "Replacement-pass-2026!" })).toThrow();
  });
});
