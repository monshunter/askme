import { z } from "zod";

import { AppError } from "@/server/errors";

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    summary: z.string().trim().min(1).max(4_000).optional(),
    highlights: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
    type: z.enum(["project", "experience", "skill", "article", "repository", "summary"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "At least one editable field is required." });

export type KnowledgeUpdate = z.infer<typeof updateSchema>;

export function parseKnowledgeUpdate(input: unknown): KnowledgeUpdate {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("INVALID_KNOWLEDGE_UPDATE", "Check the title, summary, highlights, and category fields.", 400, {
      fields: [...new Set(parsed.error.issues.flatMap((issue) => issue.path).filter((value): value is string => typeof value === "string"))],
    });
  }
  return parsed.data;
}
