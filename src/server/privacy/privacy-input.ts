import { z } from "zod";

import { AppError } from "@/server/errors";

const visibilityUpdateSchema = z.object({
  visibility: z.enum(["private", "agent_only", "citation_allowed", "public_preview"]),
}).strict();

export type VisibilityUpdate = z.infer<typeof visibilityUpdateSchema>;

export function parseVisibilityUpdate(input: unknown): VisibilityUpdate {
  const parsed = visibilityUpdateSchema.safeParse(input);
  if (!parsed.success) throw new AppError("INVALID_VISIBILITY_UPDATE", "Choose a valid source visibility.", 400);
  return parsed.data;
}
