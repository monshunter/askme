import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { PUBLIC_VISITOR_COOKIE, PUBLIC_VISITOR_HEADER, PUBLIC_VISITOR_STORAGE_KEY } from "@/shared/public-visitor";

import { createVisitorCredential, hashVisitorToken, requestClientAddress, requestSessionVisitorToken, requestVisitorToken, visitorCookieName } from "./visitor-credential";

describe("public visitor credentials", () => {
  it("creates an opaque browser visitor credential with stable transport names", () => {
    const credential = createVisitorCredential((size) => Buffer.alloc(size, 0xcd));
    expect(credential.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(credential.tokenHash).toBe(hashVisitorToken(credential.token));
    expect(credential.tokenHash).not.toContain(credential.token);
    expect(PUBLIC_VISITOR_STORAGE_KEY).toBe("askme.publicVisitor.v1");
    expect(PUBLIC_VISITOR_HEADER).toBe("x-askme-visitor-token");
    expect(PUBLIC_VISITOR_COOKIE).toBe("askme_public_visitor");
    expect(visitorCookieName("AbCdEfGhIjKlMnOpQrStUvWxYz012345")).toBe("askme_visitor_AbCdEfGhIjKl");
  });

  it("gives the browser header precedence while allowing the global cookie on non-session requests", () => {
    const headerToken = createVisitorCredential((size) => Buffer.alloc(size, 0xab)).token;
    const cookieToken = createVisitorCredential((size) => Buffer.alloc(size, 0xbc)).token;
    const request = new NextRequest("http://localhost/api/public/agents/slug/chat", {
      headers: { [PUBLIC_VISITOR_HEADER]: headerToken, cookie: `${PUBLIC_VISITOR_COOKIE}=${cookieToken}` },
    });
    expect(requestVisitorToken(request)).toBe(headerToken);
  });

  it("does not recover a cleared localStorage identity from the global transport cookie", () => {
    const globalToken = createVisitorCredential((size) => Buffer.alloc(size, 0xbc)).token;
    const legacyToken = createVisitorCredential((size) => Buffer.alloc(size, 0xcd)).token;
    const globalOnly = new NextRequest("http://localhost/api/public/agents/AbCdEfGhIjKlMnOpQrStUvWxYz012345/session", {
      headers: { cookie: `${PUBLIC_VISITOR_COOKIE}=${globalToken}` },
    });
    expect(requestSessionVisitorToken(globalOnly, "AbCdEfGhIjKlMnOpQrStUvWxYz012345")).toBeUndefined();

    const legacy = new NextRequest("http://localhost/api/public/agents/AbCdEfGhIjKlMnOpQrStUvWxYz012345/session", {
      headers: { cookie: `${visitorCookieName("AbCdEfGhIjKlMnOpQrStUvWxYz012345")}=${legacyToken}` },
    });
    expect(requestSessionVisitorToken(legacy, "AbCdEfGhIjKlMnOpQrStUvWxYz012345")).toBe(legacyToken);
  });

  it("normalizes only a valid first forwarded client address", () => {
    expect(requestClientAddress(new Headers({ "x-forwarded-for": "203.0.113.8, 10.0.0.1" }))).toBe("203.0.113.8");
    expect(requestClientAddress(new Headers({ "x-real-ip": "::ffff:192.0.2.3" }))).toBe("192.0.2.3");
    expect(requestClientAddress(new Headers({ "x-forwarded-for": "not-an-ip" }))).toBe("unknown");
  });
});
