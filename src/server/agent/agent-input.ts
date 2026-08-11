import { z } from "zod";

import { AppError } from "@/server/errors";

const chatInputSchema = z.object({
  clientMessageId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  question: z.string().transform((value) => value.replace(/\s+/g, " ").trim()).pipe(z.string().min(1).max(500)),
}).strict();

const feedbackInputSchema = z.object({ value: z.enum(["up", "down"]) }).strict();

export type ChatInput = z.infer<typeof chatInputSchema>;
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

export function parseChatInput(input: unknown): ChatInput {
  const parsed = chatInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("INVALID_CHAT_INPUT", "Send a valid question, conversation, and client message identifier.", 400);
  return parsed.data;
}

export function parseFeedbackInput(input: unknown): FeedbackInput {
  const parsed = feedbackInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("INVALID_FEEDBACK", "Choose thumbs up or thumbs down.", 400);
  return parsed.data;
}
