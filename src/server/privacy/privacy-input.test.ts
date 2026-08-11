import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { parseVisibilityUpdate } from "./privacy-input";

describe("privacy API input", () => {
  it("accepts only the four explicit visibility values", () => {
    for (const visibility of ["private", "agent_only", "citation_allowed", "public_preview"] as const) {
      expect(parseVisibilityUpdate({ visibility })).toEqual({ visibility });
    }
  });

  it("rejects missing, unknown, and extra fields", () => {
    for (const input of [{}, { visibility: "public" }, { visibility: "private", ownerId: "other" }]) {
      expect(() => parseVisibilityUpdate(input)).toThrowError(expect.objectContaining({ code: "INVALID_VISIBILITY_UPDATE" }) as Partial<AppError>);
    }
  });
});
