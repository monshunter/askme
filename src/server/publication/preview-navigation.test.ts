import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { previewRecoveryPath } from "./preview-navigation";

describe("candidate public preview navigation", () => {
  it("returns publishing management when no share link exists", () => {
    expect(previewRecoveryPath(new AppError("PUBLICATION_LINK_REQUIRED", "Generate a link first.", 409))).toBe("/workspace/publish");
  });

  it("does not hide unrelated failures", () => {
    expect(previewRecoveryPath(new Error("database unavailable"))).toBeNull();
  });
});
