import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { parseKnowledgeUpdate } from "./knowledge-input";
import { parseKnowledgeListQuery } from "./knowledge-query";

describe("knowledge API inputs", () => {
  it("parses bounded list filters", () => {
    expect(parseKnowledgeListQuery(new URLSearchParams())).toEqual({ page: 1, pageSize: 20, status: "active", sort: "updated" });
    expect(parseKnowledgeListQuery(new URLSearchParams("page=2&pageSize=50&type=project&search=askme&citationReady=true&sort=confidence"))).toEqual({
      page: 2,
      pageSize: 50,
      type: "project",
      status: "active",
      search: "askme",
      citationReady: true,
      sort: "confidence",
    });
  });

  it("rejects unsupported filters and unbounded pages", () => {
    expect(() => parseKnowledgeListQuery(new URLSearchParams("pageSize=1000"))).toThrowError(
      expect.objectContaining({ code: "INVALID_KNOWLEDGE_QUERY" }) as Partial<AppError>,
    );
    expect(() => parseKnowledgeListQuery(new URLSearchParams("type=award"))).toThrowError(
      expect.objectContaining({ code: "INVALID_KNOWLEDGE_QUERY" }) as Partial<AppError>,
    );
  });

  it("accepts only the editable knowledge fields and at least one change", () => {
    expect(parseKnowledgeUpdate({ title: "Askme", type: "project", highlights: ["Owner-isolated"] })).toEqual({
      title: "Askme",
      type: "project",
      highlights: ["Owner-isolated"],
    });
    expect(() => parseKnowledgeUpdate({})).toThrowError(expect.objectContaining({ code: "INVALID_KNOWLEDGE_UPDATE" }) as Partial<AppError>);
    expect(() => parseKnowledgeUpdate({ confidence: 1 })).toThrowError(expect.objectContaining({ code: "INVALID_KNOWLEDGE_UPDATE" }) as Partial<AppError>);
  });
});
