import { describe, expect, it } from "vitest";

import { createInvitationCredential, hashInvitationToken } from "./invitation-token";

describe("Admin invitation credentials", () => {
  it("stores only a deterministic hash of an opaque token", () => {
    const credential = createInvitationCredential();
    expect(credential.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(credential.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(credential.tokenHash).toBe(hashInvitationToken(credential.token));
    expect(credential.tokenHash).not.toContain(credential.token);
  });
});
