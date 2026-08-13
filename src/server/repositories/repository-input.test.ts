import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { parseDossierApprovalInput, parseRepositoryPublicDeepInput, parseRepositorySyncInput, parseRepositoryVisibilityInput, parseWikiProjectionPageInput } from "./repository-input";

describe("Repository API input", () => {
  it("accepts bounded sync input without normalizing away the one-request Token", () => {
    expect(parseRepositorySyncInput({
      repositoryUrl: "https://github.com/QuantumNous/new-api",
      ref: " main ",
      token: " request-token ",
      visibility: "public_preview",
      excludePatterns: ["fixtures/**", "generated/**"],
    })).toEqual({
      repositoryUrl: "https://github.com/QuantumNous/new-api",
      ref: "main",
      token: "request-token",
      visibility: "public_preview",
      excludePatterns: ["fixtures/**", "generated/**"],
    });
  });

  it("rejects unknown fields, unsupported visibility and unbounded excludes", () => {
    expect(() => parseRepositorySyncInput({ repositoryUrl: "https://github.com/org/repo", ref: "main", visibility: "world", extra: true })).toThrowError(expect.objectContaining({ code: "INVALID_REPOSITORY_SYNC_INPUT" }) as Partial<AppError>);
    expect(() => parseRepositorySyncInput({ repositoryUrl: "https://github.com/org/repo", ref: "main", visibility: "private", excludePatterns: Array.from({ length: 101 }, () => "x") })).toThrowError(expect.objectContaining({ code: "INVALID_REPOSITORY_SYNC_INPUT" }) as Partial<AppError>);
  });

  it("parses only the four Repository visibility values", () => {
    expect(parseRepositoryVisibilityInput({ visibility: "agent_only" })).toEqual({ visibility: "agent_only" });
    expect(() => parseRepositoryVisibilityInput({ visibility: "public" })).toThrowError(expect.objectContaining({ code: "INVALID_REPOSITORY_VISIBILITY" }) as Partial<AppError>);
  });

  it("keeps the public deep-analysis switch separate from visibility", () => {
    expect(parseRepositoryPublicDeepInput({ publicDeepAnalysisEnabled: true })).toEqual({ publicDeepAnalysisEnabled: true });
    expect(() => parseRepositoryPublicDeepInput({ publicDeepAnalysisEnabled: "yes", visibility: "public_preview" })).toThrowError(expect.objectContaining({ code: "INVALID_REPOSITORY_PUBLIC_DEEP_SETTING" }) as Partial<AppError>);
  });

  it("accepts only edits to an existing generated Wiki page and an explicit approval target", () => {
    const pageId = "11111111-1111-4111-8111-111111111111";
    const dossierId = "22222222-2222-4222-8222-222222222222";
    const markdown = `# Overview\n\n## Architecture\n${"grounded content ".repeat(20)}`;
    expect(parseWikiProjectionPageInput({ pageId, editedMarkdown: markdown })).toEqual({
      pageId,
      editedMarkdown: markdown.trim(),
    });
    expect(parseDossierApprovalInput({ dossierId })).toEqual({ dossierId });
    expect(() => parseWikiProjectionPageInput({ pageId, editedMarkdown: "too short" })).toThrowError(expect.objectContaining({ code: "INVALID_WIKI_PROJECTION_PAGE" }) as Partial<AppError>);
    expect(() => parseDossierApprovalInput({ dossierId, force: true })).toThrowError(expect.objectContaining({ code: "INVALID_DOSSIER_APPROVAL" }) as Partial<AppError>);
  });
});
