import { z } from "zod";

import { AppError } from "@/server/errors";

const publicChatInputSchema = z.object({
  conversationId: z.string().uuid(),
  clientMessageId: z.string().uuid(),
  question: z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(500)),
}).strict();

const feedbackInputSchema = z.object({ value: z.enum(["up", "down"]) }).strict();

export type PublicChatInput = z.infer<typeof publicChatInputSchema>;
export type PublicFeedbackInput = z.infer<typeof feedbackInputSchema>;

export function parsePublicChatInput(input: unknown): PublicChatInput {
  const parsed = publicChatInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("INVALID_PUBLIC_CHAT_INPUT", "Send a valid conversation, question, and client message identifier.", 400);
  return parsed.data;
}

export function parsePublicFeedbackInput(input: unknown): PublicFeedbackInput {
  const parsed = feedbackInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("INVALID_FEEDBACK", "Choose thumbs up or thumbs down.", 400);
  return parsed.data;
}
