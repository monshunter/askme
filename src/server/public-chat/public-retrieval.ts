import "server-only";

import { retrieveEvidence } from "@/server/agent/retrieval-service";

import { assessPublicQuestion } from "./public-question-policy";

export async function retrievePublicQuestionEvidence(ownerId: string, question: string) {
  const assessment = assessPublicQuestion(question);
  if (!assessment.allowed) return { assessment, evidence: [] };
  return { assessment, evidence: await retrieveEvidence(ownerId, "public_answer", { query: assessment.question, limit: 8 }) };
}
