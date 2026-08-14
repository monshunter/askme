import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildPublicUrl } from "./public-url";

describe("public email URLs", () => {
  it("keeps each email path under the configured public base URL", () => {
    expect(buildPublicUrl("https://askme.monshunter.xyz/", "/reset-password/reset-token")).toBe(
      "https://askme.monshunter.xyz/reset-password/reset-token",
    );
    expect(buildPublicUrl("https://careers.example.test/", "/invite/invitation-token")).toBe(
      "https://careers.example.test/invite/invitation-token",
    );
  });
});
