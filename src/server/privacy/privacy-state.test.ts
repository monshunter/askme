import { describe, expect, it } from "vitest";

import { derivePrivacyConfirmation } from "./privacy-state";

describe("privacy confirmation state", () => {
  it("is confirmed only at the current policy revision", () => {
    const confirmedAt = new Date("2026-08-11T00:00:00.000Z");
    expect(derivePrivacyConfirmation(3, { policyRevision: 3, confirmedAt })).toEqual({ confirmed: true, requiresReconfirmation: false, policyRevision: 3, confirmedAt });
    expect(derivePrivacyConfirmation(4, { policyRevision: 3, confirmedAt })).toEqual({ confirmed: false, requiresReconfirmation: true, policyRevision: 4, confirmedAt: null });
  });

  it("starts unconfirmed at revision one", () => {
    expect(derivePrivacyConfirmation(1, null)).toEqual({ confirmed: false, requiresReconfirmation: false, policyRevision: 1, confirmedAt: null });
  });
});
