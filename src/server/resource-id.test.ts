import { describe, expect, it } from "vitest";

import { AppError } from "./errors";
import { requireResourceId } from "./resource-id";

describe("resource identifiers", () => {
  it("accepts canonical UUID resource ids", () => {
    expect(requireResourceId("22222222-2222-4222-8222-222222222222", "material")).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("maps malformed ids to the same hidden not-found response", () => {
    expect(() => requireResourceId("not-a-uuid", "material")).toThrowError(
      expect.objectContaining({ code: "MATERIAL_NOT_FOUND", status: 404 }) as Partial<AppError>,
    );
    expect(() => requireResourceId("../private", "knowledge")).toThrowError(
      expect.objectContaining({ code: "KNOWLEDGE_NOT_FOUND", status: 404 }) as Partial<AppError>,
    );
    expect(() => requireResourceId("bad", "message")).toThrowError(
      expect.objectContaining({ code: "MESSAGE_NOT_FOUND", status: 404 }) as Partial<AppError>,
    );
    expect(() => requireResourceId("bad", "repository")).toThrowError(
      expect.objectContaining({ code: "REPOSITORY_NOT_FOUND", status: 404 }) as Partial<AppError>,
    );
    expect(() => requireResourceId("bad", "analysis_run")).toThrowError(
      expect.objectContaining({ code: "ANALYSIS_RUN_NOT_FOUND", status: 404 }) as Partial<AppError>,
    );
  });
});
