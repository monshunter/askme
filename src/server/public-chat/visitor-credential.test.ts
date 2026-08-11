import { describe, expect, it } from "vitest";

import { createVisitorCredential, hashVisitorToken, requestClientAddress, visitorCookieName } from "./visitor-credential";

describe("public visitor credentials", () => {
  it("creates an opaque per-slug cookie credential", () => {
    const credential = createVisitorCredential((size) => Buffer.alloc(size, 0xcd));
    expect(credential.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(credential.tokenHash).toBe(hashVisitorToken(credential.token));
    expect(credential.tokenHash).not.toContain(credential.token);
    expect(visitorCookieName("AbCdEfGhIjKlMnOpQrStUvWxYz012345")).toBe("askme_visitor_AbCdEfGhIjKl");
  });

  it("normalizes only a valid first forwarded client address", () => {
    expect(requestClientAddress(new Headers({ "x-forwarded-for": "203.0.113.8, 10.0.0.1" }))).toBe("203.0.113.8");
    expect(requestClientAddress(new Headers({ "x-real-ip": "::ffff:192.0.2.3" }))).toBe("192.0.2.3");
    expect(requestClientAddress(new Headers({ "x-forwarded-for": "not-an-ip" }))).toBe("unknown");
  });
});
