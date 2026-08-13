import { z } from "zod";

import { AppError } from "@/server/errors";

const visibility = z.enum(["private", "agent_only", "citation_allowed", "public_preview"]);
const repositorySyncSchema = z.object({
  repositoryUrl: z.string().trim().url().max(2_048),
  ref: z.string().trim().min(1).max(255),
  token: z.string().trim().min(1).max(2_000).optional(),
  visibility,
  excludePatterns: z.array(z.string().trim().min(1).max(1_024)).max(100).default([]),
}).strict();
const repositoryVisibilitySchema = z.object({ visibility }).strict();
const repositoryPublicDeepSchema = z.object({ publicDeepAnalysisEnabled: z.boolean() }).strict();
const repositoryResyncSchema = z.object({
  ref: z.string().trim().min(1).max(255),
  token: z.string().trim().min(1).max(2_000).optional(),
  excludePatterns: z.array(z.string().trim().min(1).max(1_024)).max(100).default([]),
}).strict();
const wikiProjectionPageSchema = z.object({
  pageId: z.string().uuid(),
  editedMarkdown: z.string().trim().min(200).max(500_000).nullable().default(null),
}).strict();
const dossierApprovalSchema = z.object({ dossierId: z.string().uuid() }).strict();

export type RepositorySyncInput = z.infer<typeof repositorySyncSchema>;
export type RepositoryVisibilityInput = z.infer<typeof repositoryVisibilitySchema>;
export type RepositoryPublicDeepInput = z.infer<typeof repositoryPublicDeepSchema>;
export type RepositoryResyncInput = z.infer<typeof repositoryResyncSchema>;
export type WikiProjectionPageInput = z.infer<typeof wikiProjectionPageSchema>;
export type DossierApprovalInput = z.infer<typeof dossierApprovalSchema>;

export function parseRepositorySyncInput(input: unknown): RepositorySyncInput {
  const parsed = repositorySyncSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("INVALID_REPOSITORY_SYNC_INPUT", "Check the Repository URL, ref, visibility, Token, and exclude patterns.", 400, {
      fields: [...new Set(parsed.error.issues.map((issue) => issue.path[0]).filter((value): value is string => typeof value === "string"))],
    });
  }
  return parsed.data;
}

export function parseRepositoryVisibilityInput(input: unknown): RepositoryVisibilityInput {
  const parsed = repositoryVisibilitySchema.safeParse(input);
  if (!parsed.success) throw new AppError("INVALID_REPOSITORY_VISIBILITY", "Choose a supported Repository visibility.", 400);
  return parsed.data;
}

export function parseRepositoryPublicDeepInput(input: unknown): RepositoryPublicDeepInput {
  const parsed = repositoryPublicDeepSchema.safeParse(input);
  if (!parsed.success) throw new AppError("INVALID_REPOSITORY_PUBLIC_DEEP_SETTING", "Choose whether public deep Repository analysis is enabled.", 400);
  return parsed.data;
}

export function parseRepositoryResyncInput(input: unknown): RepositoryResyncInput {
  const parsed = repositoryResyncSchema.safeParse(input);
  if (!parsed.success) throw new AppError("INVALID_REPOSITORY_RESYNC_INPUT", "Check the ref, Token, and exclude patterns.", 400);
  return parsed.data;
}

export function parseWikiProjectionPageInput(input: unknown): WikiProjectionPageInput {
  const parsed = wikiProjectionPageSchema.safeParse(input);
  if (!parsed.success) throw new AppError("INVALID_WIKI_PROJECTION_PAGE", "Choose an existing Repository Wiki page and valid Markdown.", 400);
  return parsed.data;
}

export function parseDossierApprovalInput(input: unknown): DossierApprovalInput {
  const parsed = dossierApprovalSchema.safeParse(input);
  if (!parsed.success) throw new AppError("INVALID_DOSSIER_APPROVAL", "Choose a generated Dossier to approve.", 400);
  return parsed.data;
}
