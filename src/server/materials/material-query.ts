import { z } from "zod";

import { AppError } from "@/server/errors";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["queued", "processing", "indexed", "failed"]).optional(),
  kind: z.enum(["file", "github", "notion", "website"]).optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(["newest", "oldest"]).default("newest"),
});

export type MaterialListQuery = z.infer<typeof listQuerySchema>;

export function parseMaterialListQuery(parameters: URLSearchParams): MaterialListQuery {
  const parsed = listQuerySchema.safeParse(Object.fromEntries(parameters.entries()));
  if (!parsed.success) {
    throw new AppError("INVALID_MATERIAL_QUERY", "Check the material filters and pagination values.", 400, {
      fields: [...new Set(parsed.error.issues.map((issue) => issue.path[0]).filter((value): value is string => typeof value === "string"))],
    });
  }
  return parsed.data;
}
