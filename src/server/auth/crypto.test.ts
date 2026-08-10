import { describe, expect, it } from "vitest";

import { createSessionCredential, hashPassword, verifyPassword } from "./crypto";

describe("auth crypto", () => {
  it("hashes a password with a unique salt and verifies without storing plaintext", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");

    expect(first).not.toContain("correct horse battery staple");
    expect(first).not.toBe(second);
    await expect(verifyPassword("correct horse battery staple", first)).resolves.toBe(true);
    await expect(verifyPassword("wrong", first)).resolves.toBe(false);
  });

  it("creates a random session token while exposing only its hash for storage", () => {
    const first = createSessionCredential();
    const second = createSessionCredential();

    expect(first.token).not.toBe(second.token);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.tokenHash).not.toContain(first.token);
  });
});
