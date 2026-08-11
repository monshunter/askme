import { describe, expect, it } from "vitest";

import { createPublicSlug, evaluatePublishReadiness, parsePublicSlug } from "./publication-policy";

describe("publication policy", () => {
  it("requires indexed material, current privacy confirmation, and public identity", () => {
    const ready = evaluatePublishReadiness({ indexedMaterials: 1, policyRevision: 3, confirmedRevision: 3, displayName: "Alex Morgan", headline: "AI Agent Engineer" });
    expect(ready.ready).toBe(true);
    expect(ready.checks.every((check) => check.ready)).toBe(true);

    const blocked = evaluatePublishReadiness({ indexedMaterials: 0, policyRevision: 4, confirmedRevision: 3, displayName: "Alex", headline: null });
    expect(blocked.ready).toBe(false);
    expect(blocked.checks.filter((check) => !check.ready).map((check) => check.key)).toEqual(["indexed_material", "privacy_confirmation", "public_identity"]);
  });

  it("creates an opaque slug that contains no owner identifier", () => {
    const slug = createPublicSlug((size) => Buffer.alloc(size, 0xab));
    expect(slug).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(slug).not.toContain("alex");
  });

  it("accepts only the opaque public slug shape", () => {
    const value = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    expect(parsePublicSlug(value)).toBe(value);
    for (const invalid of ["zoe@example.com", "short", `${value}/private`, "a".repeat(33)]) {
      expect(() => parsePublicSlug(invalid)).toThrowError(expect.objectContaining({ code: "PUBLIC_AGENT_UNAVAILABLE" }));
    }
  });
});
