import { z } from "zod";

import { AppError } from "@/server/errors";

const rangeSchema = z.enum(["7d", "30d", "90d"]);
const reasonSchema = z.string().trim().min(3).max(500);
const listPageSchema = z.coerce.number().int().min(1).default(1);
const listPageSizeSchema = z.coerce.number().int().min(1).max(100).default(20);
const searchSchema = z.string().trim().max(120).default("");

export type AdminRange = z.infer<typeof rangeSchema>;

function parseInput<T>(schema: z.ZodType<T>, value: unknown, code: string, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(code, message, 400, {
      fields: [...new Set(parsed.error.issues.map((issue) => issue.path[0]).filter((field): field is string => typeof field === "string"))],
    });
  }
  return parsed.data;
}

export function parseAdminRange(value: string | null | undefined): AdminRange {
  return parseInput(rangeSchema, value ?? "7d", "INVALID_ADMIN_RANGE", "Choose a supported report range.");
}

export function parseAdminListQuery(searchParams: URLSearchParams) {
  return parseInput(z.object({ search: searchSchema, page: listPageSchema, pageSize: listPageSizeSchema }).strict(), {
    search: searchParams.get("search") ?? "",
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  }, "INVALID_ADMIN_QUERY", "Check the search and pagination values.");
}

export function parseCandidateListQuery(searchParams: URLSearchParams) {
  return { ...parseAdminListQuery(searchParams), status: parseInput(z.enum(["all", "active", "suspended"]), searchParams.get("status") ?? "all", "INVALID_CANDIDATE_QUERY", "Choose a valid Candidate status.") };
}

export function parseAgentListQuery(searchParams: URLSearchParams) {
  return { ...parseAdminListQuery(searchParams), status: parseInput(z.enum(["all", "published", "paused", "revoked"]), searchParams.get("status") ?? "all", "INVALID_AGENT_QUERY", "Choose a valid Agent status.") };
}

export function parseReviewListQuery(searchParams: URLSearchParams) {
  return {
    ...parseAdminListQuery(searchParams),
    status: parseInput(z.enum(["all", "open", "reviewing", "resolved", "dismissed"]), searchParams.get("status") ?? "all", "INVALID_REVIEW_QUERY", "Choose a valid review status."),
    severity: parseInput(z.enum(["all", "low", "medium", "high"]), searchParams.get("severity") ?? "all", "INVALID_REVIEW_QUERY", "Choose a valid review severity."),
  };
}

export function parseAdminSearchQuery(searchParams: URLSearchParams) {
  return parseInput(z.string().trim().min(2).max(120), searchParams.get("q"), "INVALID_ADMIN_SEARCH", "Enter between 2 and 120 characters to search.");
}

const candidateStatusInput = z.object({
  status: z.enum(["active", "suspended"]),
  reason: reasonSchema,
}).strict();

const publicationActionInput = z.object({
  action: z.enum(["pause", "restore"]),
  reason: reasonSchema,
}).strict();

const repositoryActionInput = z.object({
  action: z.enum(["disable", "enable"]),
  reason: reasonSchema,
}).strict();

const analysisRunActionInput = z.object({
  reason: reasonSchema,
}).strict();

const contentReviewInput = z.object({
  action: z.enum(["review", "resolve", "dismiss"]),
  note: reasonSchema,
}).strict();

const settingsInput = z.object({
  publicSessionHourlyLimit: z.number().int().min(1).max(100).optional(),
  publicChatMinuteLimit: z.number().int().min(1).max(60).optional(),
  publicChatDailyLimit: z.number().int().min(1).max(500).optional(),
  negativeFeedbackAutoFlag: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one platform policy is required.");

const invitationInput = z.object({
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(1).max(120),
}).strict();

const invitationAcceptance = z.object({
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(200),
}).strict();

export type CandidateStatusInput = z.infer<typeof candidateStatusInput>;
export type PublicationActionInput = z.infer<typeof publicationActionInput>;
export type RepositoryActionInput = z.infer<typeof repositoryActionInput>;
export type AnalysisRunActionInput = z.infer<typeof analysisRunActionInput>;
export type ContentReviewInput = z.infer<typeof contentReviewInput>;
export type SettingsInput = z.infer<typeof settingsInput>;
export type InvitationInput = z.infer<typeof invitationInput>;
export type InvitationAcceptance = z.infer<typeof invitationAcceptance>;

export function parseCandidateStatusInput(value: unknown) {
  return parseInput(candidateStatusInput, value, "INVALID_CANDIDATE_STATUS", "Choose a valid Candidate status and reason.");
}

export function parsePublicationActionInput(value: unknown) {
  return parseInput(publicationActionInput, value, "INVALID_AGENT_ACTION", "Choose a valid Agent action and reason.");
}

export function parseRepositoryActionInput(value: unknown) {
  return parseInput(repositoryActionInput, value, "INVALID_REPOSITORY_ACTION", "Choose a valid Repository action and reason.");
}

export function parseAnalysisRunActionInput(value: unknown) {
  return parseInput(analysisRunActionInput, value, "INVALID_ANALYSIS_RUN_ACTION", "Enter a reason for cancelling the analysis run.");
}

export function parseContentReviewInput(value: unknown) {
  return parseInput(contentReviewInput, value, "INVALID_REVIEW_ACTION", "Choose a valid review action and decision note.");
}

export function parseSettingsInput(value: unknown) {
  return parseInput(settingsInput, value, "INVALID_PLATFORM_SETTINGS", "Check the supported platform policy values.");
}

export function requireAdminResourceId(value: string) {
  return parseInput(z.string().uuid(), value, "ADMIN_TARGET_NOT_FOUND", "The governance target was not found.");
}

export function parseInvitationInput(value: unknown) {
  return parseInput(invitationInput, value, "INVALID_ADMIN_INVITATION", "Enter a valid email address and display name.");
}

export function parseInvitationAcceptance(value: unknown) {
  return parseInput(invitationAcceptance, value, "INVALID_INVITATION_ACCEPTANCE", "Enter a display name and a password of at least 12 characters.");
}

export function requireInvitationToken(value: string) {
  return parseInput(z.string().regex(/^[A-Za-z0-9_-]{43}$/), value, "INVITATION_UNAVAILABLE", "This invitation is unavailable or expired.");
}
