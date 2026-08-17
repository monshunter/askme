import { z } from "zod";

import { AppError } from "@/server/errors";

const agentSettingsPatchSchema = z
  .object({
    answerTone: z.enum(["professional", "concise", "conversational"]).optional(),
    publicMode: z.boolean().optional(),
    privacySafeMode: z.boolean().optional(),
    profileMaterialId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export type AgentSettingsPatch = z.infer<typeof agentSettingsPatchSchema>;

export function parseAgentSettingsPatch(input: unknown): AgentSettingsPatch {
  const parsed = agentSettingsPatchSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("INVALID_AGENT_SETTINGS", "Change at least one valid Agent setting.", 400);
  }
  return parsed.data;
}
