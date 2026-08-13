import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { parseMaterialListQuery } from "./material-query";

describe("material list query", () => {
  it("applies stable defaults and accepts owner-safe filters", () => {
    expect(parseMaterialListQuery(new URLSearchParams())).toEqual({ page: 1, pageSize: 20, sort: "newest" });
    expect(parseMaterialListQuery(new URLSearchParams("page=2&pageSize=50&kind=notion&status=failed&search=askme&sort=oldest"))).toEqual({
      page: 2,
      pageSize: 50,
      kind: "notion",
      status: "failed",
      search: "askme",
      sort: "oldest",
    });
  });

  it("rejects unsupported filters and unbounded pagination", () => {
    expect(() => parseMaterialListQuery(new URLSearchParams("pageSize=101"))).toThrowError(
      expect.objectContaining({ code: "INVALID_MATERIAL_QUERY" }) as Partial<AppError>,
    );
    expect(() => parseMaterialListQuery(new URLSearchParams("status=deleted"))).toThrowError(
      expect.objectContaining({ code: "INVALID_MATERIAL_QUERY" }) as Partial<AppError>,
    );
    expect(() => parseMaterialListQuery(new URLSearchParams("kind=github"))).toThrowError(
      expect.objectContaining({ code: "INVALID_MATERIAL_QUERY" }) as Partial<AppError>,
    );
  });
});
