import { z } from "zod";

import type { ChatMessage, CompletionOptions } from "@/server/ai/openai-compatible";
import { AppError } from "@/server/errors";

const decisionSchema = z.object({
  route: z.enum(["rag", "deep", "refuse"]),
  reasonCode: z.enum([
    "evidence_sufficient",
    "source_inspection_required",
    "out_of_scope",
    "ambiguous_repository",
    "insufficient_authorized_evidence",
  ]),
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

function sourceInspectionIntent(question: string) {
  const hasCodeSubject = /`[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?`|\b(?:function|method|class|source code)\b|函数|方法|类|源码/iu.test(question);
  const asksImplementation = /如何|怎么|怎样|处理|实现|行为|边界|分支|调用链|调用|剩余|返回|深度检查|原始源码|\b(?:how|implementation|behaviou?r|edge case|branch|call flow|return|inspect)\b/iu.test(question);
  return hasCodeSubject && asksImplementation;
}

export function selectSourceInspectionRepository(question: string, repositories: QuestionRouteRepository[]) {
  if (!sourceInspectionIntent(question)) return null;
  const allowed = repositories.filter((repository) => repository.deepAllowed);
  if (allowed.length === 1) return allowed[0]!;
  const normalized = question.toLocaleLowerCase();
  const matched = allowed.filter((repository) => {
    const displayName = repository.displayName.toLocaleLowerCase();
    const shortName = displayName.split("/").at(-1) ?? displayName;
    return normalized.includes(displayName) || (shortName.length >= 3 && normalized.includes(shortName));
  });
  return matched.length === 1 ? matched[0]! : null;
}

export function effectiveQuestionRoute(decision: { route: "rag" | "deep" | "refuse"; reasonCode: string; confidence: number }, selected: QuestionRouteRepository | null, sourceInspectionRequired = false) {
  if (sourceInspectionRequired && selected?.deepAllowed) return "deep" as const;
  if (decision.route === "deep" && decision.confidence >= 0.65 && selected?.deepAllowed) return "deep" as const;
  if (decision.route === "refuse" && (decision.reasonCode === "ambiguous_repository" || decision.reasonCode === "deep_analysis_not_allowed")) return "refuse" as const;
  return "rag" as const;
}

export function selectInsufficientEvidenceRepository(
  question: string,
  decision: { route: "rag" | "deep" | "refuse"; repositoryId?: string | null },
  repositories: QuestionRouteRepository[],
) {
  if (decision.route !== "rag" || !decision.repositoryId) return null;
  const selected = repositories.find((repository) => repository.id === decision.repositoryId && repository.deepAllowed);
  if (!selected) return null;
  const normalizedQuestion = question.normalize("NFKC").toLocaleLowerCase();
  const displayName = selected.displayName.normalize("NFKC").toLocaleLowerCase();
  const shortName = displayName.split("/").at(-1) ?? displayName;
  return normalizedQuestion.includes(displayName) || (shortName.length >= 3 && normalizedQuestion.includes(shortName)) ? selected : null;
}

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
        "Choose rag when supplied document or approved-Wiki evidence can answer it. Choose deep when the user asks to inspect exact implementation, execution flow, source lines, or another fact that requires original Repository source inspection. Choose refuse when the request is outside the career scope or cannot be served safely.",
        "Use reasonCode=evidence_sufficient for rag, source_inspection_required for deep, and out_of_scope, ambiguous_repository, or insufficient_authorized_evidence for refuse. Never invent or widen a repository id. Return one JSON object only: {\"route\":\"rag\"|\"deep\"|\"refuse\",\"reasonCode\":\"evidence_sufficient\"|\"source_inspection_required\"|\"out_of_scope\"|\"ambiguous_repository\"|\"insufficient_authorized_evidence\",\"confidence\":number,\"repositoryId\":string|null}.",
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
    return { route: "refuse" as const, reasonCode: "deep_analysis_not_allowed" as const, confidence: 1, repositoryId: selected!.id, usage };
  }
  return { ...decision, usage };
}
