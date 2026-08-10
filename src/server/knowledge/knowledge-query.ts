import { z } from "zod";

import { AppError } from "@/server/errors";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(["project", "experience", "skill", "article", "repository", "summary"]).optional(),
  status: z.enum(["active", "archived"]).default("active"),
  search: z.string().trim().max(200).optional(),
  citationReady: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  sort: z.enum(["updated", "confidence", "title"]).default("updated"),
});

export type KnowledgeListQuery = z.infer<typeof querySchema>;

export function parseKnowledgeListQuery(parameters: URLSearchParams): KnowledgeListQuery {
  const parsed = querySchema.safeParse(Object.fromEntries(parameters.entries()));
  if (!parsed.success) {
    throw new AppError("INVALID_KNOWLEDGE_QUERY", "Check the knowledge filters and pagination values.", 400, {
      fields: [...new Set(parsed.error.issues.map((issue) => issue.path[0]).filter((value): value is string => typeof value === "string"))],
    });
  }
  return parsed.data;
}
