import { describe, expect, it } from "vitest";

// @ts-expect-error The isolated guest runtime is shipped as native ESM JavaScript.
import { repositoryHardSourceToolLimit, repositorySourceToolLimit, repositoryWriteReserve } from "./budget-policy.mjs";

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
});
