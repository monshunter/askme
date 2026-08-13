import { z } from "zod";

import type { ChatMessage, CompletionOptions } from "@/server/ai/openai-compatible";
import { AppError } from "@/server/errors";

const decisionSchema = z.object({
  route: z.enum(["rag", "deep", "refuse"]),
  reason: z.string().trim().min(1).max(1_000),
  confidence: z.coerce.number().min(0).max(1),
  repositoryId: z.string().uuid().nullable().optional().default(null),
});

export type QuestionRouterClient = {
  complete(messages: ChatMessage[], options?: CompletionOptions): Promise<{
    content: string;
    inputTokens: number | null;
    outputTokens: number | null;
  }>;
};

export type QuestionRouteRepository = {
  id: string;
  displayName: string;
  deepAllowed: boolean;
};

function parseDecision(content: string) {
  try {
    const json = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return decisionSchema.parse(JSON.parse(json));
  } catch {
    throw new AppError("AI_ROUTER_INVALID", "The AI Router returned an invalid routing decision.", 502);
  }
}

export async function routeQuestion(input: {
  question: string;
  evidenceSummaries: string[];
  repositories: QuestionRouteRepository[];
}, client: QuestionRouterClient) {
  const completion = await client.complete([
    {
      role: "system",
      content: [
        "Route one career-Agent question using only the Host-authorized context below.",
        "Choose rag when supplied document or approved-Dossier evidence can answer it; choose deep only when exact original Repository source inspection is required; choose refuse when the request is outside the career scope or cannot be served safely.",
        "Never invent or widen a repository id. Return one JSON object only: {\"route\":\"rag\"|\"deep\"|\"refuse\",\"reason\":string,\"confidence\":number,\"repositoryId\":string|null}.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        question: input.question.slice(0, 500),
        evidence: input.evidenceSummaries.slice(0, 12).map((summary) => summary.replace(/\s+/g, " ").trim().slice(0, 500)),
        repositories: input.repositories.map((repository) => ({ id: repository.id, displayName: repository.displayName })),
      }),
    },
  ], { jsonObject: true, maxTokens: 300, temperature: 0 });
  const decision = parseDecision(completion.content);
  const selected = decision.repositoryId
    ? input.repositories.find((repository) => repository.id === decision.repositoryId)
    : null;
  if (decision.repositoryId && !selected) {
    throw new AppError("AI_ROUTER_INVALID", "The AI Router selected a Repository outside its authorized candidates.", 502);
  }
  if (decision.route === "deep" && !selected) {
    throw new AppError("AI_ROUTER_INVALID", "The AI Router did not select one authorized Repository for deep analysis.", 502);
  }
  const usage = { inputTokens: completion.inputTokens, outputTokens: completion.outputTokens };
  if (decision.route === "deep" && !selected!.deepAllowed) {
    return { route: "refuse" as const, reason: "deep_analysis_not_allowed", confidence: 1, repositoryId: selected!.id, usage };
  }
  return { ...decision, usage };
}
