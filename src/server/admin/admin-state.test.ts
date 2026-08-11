import { describe, expect, it } from "vitest";

import { candidateStatusTransition, contentReviewTransition, publicationStatusTransition } from "./admin-state";

describe("Admin governance state machines", () => {
  it("keeps Candidate status updates idempotent", () => {
    expect(candidateStatusTransition("active", "suspended")).toEqual({ next: "suspended", changed: true });
    expect(candidateStatusTransition("suspended", "suspended")).toEqual({ next: "suspended", changed: false });
  });

  it("allows only published and paused Agent governance transitions", () => {
    expect(publicationStatusTransition("published", "pause")).toEqual({ next: "paused", changed: true });
    expect(publicationStatusTransition("paused", "restore")).toEqual({ next: "published", changed: true });
    expect(publicationStatusTransition("paused", "pause")).toEqual({ next: "paused", changed: false });
    expect(() => publicationStatusTransition("revoked", "restore")).toThrowError(expect.objectContaining({ status: 409 }));
  });

  it("keeps review terminal states terminal", () => {
    expect(contentReviewTransition("open", "review")).toEqual({ next: "reviewing", changed: true });
    expect(contentReviewTransition("reviewing", "resolve")).toEqual({ next: "resolved", changed: true });
    expect(() => contentReviewTransition("resolved", "dismiss")).toThrowError(expect.objectContaining({ status: 409 }));
  });
});
