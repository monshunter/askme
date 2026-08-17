import { describe, expect, it } from "vitest";

// @ts-expect-error The isolated guest runtime is shipped as native ESM JavaScript.
import { repositoryHardSourceRoundLimit, repositoryHardSourceToolLimit, repositorySourceRoundLimit, repositorySourceToolsShouldLock, repositorySourceToolLimit, repositoryWriteReserve } from "./budget-policy.mjs";

describe("Repository Wiki tool budget policy", () => {
  it("reserves 32 calls for Wiki output from the default 80-call budget", () => {
    expect(repositoryWriteReserve(80)).toBe(32);
    expect(repositorySourceToolLimit(80)).toBe(48);
    expect(repositoryHardSourceToolLimit(80)).toBe(60);
  });

  it("scales the reserve for a bounded correction session", () => {
    expect(repositoryWriteReserve(26)).toBe(11);
    expect(repositorySourceToolLimit(26)).toBe(15);
    expect(repositoryHardSourceToolLimit(26)).toBe(15);
  });

  it("never reserves more calls than remain", () => {
    expect(repositoryWriteReserve(8)).toBe(8);
    expect(repositorySourceToolLimit(8)).toBe(0);
  });

  it("reserves the final rounds for Wiki output before the default round budget is exhausted", () => {
    expect(repositorySourceRoundLimit(100)).toBe(80);
    expect(repositoryHardSourceRoundLimit(100)).toBe(90);
  });

  it("scales round convergence for legacy and bounded correction budgets", () => {
    expect(repositorySourceRoundLimit(50)).toBe(40);
    expect(repositoryHardSourceRoundLimit(50)).toBe(44);
    expect(repositorySourceRoundLimit(15)).toBe(5);
    expect(repositoryHardSourceRoundLimit(15)).toBe(9);
  });

  it("locks source tools at either soft boundary with coverage or either hard boundary", () => {
    const state = { maxRounds: 100, maxToolCalls: 300, minimumExaminedPaths: 30 };
    expect(repositorySourceToolsShouldLock({ ...state, rounds: 79, toolCalls: 267, examinedPathCount: 30 })).toBe(false);
    expect(repositorySourceToolsShouldLock({ ...state, rounds: 80, toolCalls: 267, examinedPathCount: 30 })).toBe(true);
    expect(repositorySourceToolsShouldLock({ ...state, rounds: 80, toolCalls: 267, examinedPathCount: 29 })).toBe(false);
    expect(repositorySourceToolsShouldLock({ ...state, rounds: 90, toolCalls: 267, examinedPathCount: 29 })).toBe(true);
    expect(repositorySourceToolsShouldLock({ ...state, rounds: 79, toolCalls: 268, examinedPathCount: 30 })).toBe(true);
    expect(repositorySourceToolsShouldLock({ ...state, rounds: 79, toolCalls: 280, examinedPathCount: 29 })).toBe(true);
  });
});
