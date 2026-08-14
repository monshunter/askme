import { AppError } from "@/server/errors";
import { answerMatchesQuestionLanguage } from "@/server/agent/question-language";
import { citationContentHash, type DossierArtifactEvidence } from "@/server/repositories/dossier-output";

import { codeAnswerResultSchema } from "./contracts";

export function validateCodeAnswerOutput(input: unknown, evidence: DossierArtifactEvidence, question?: string) {
  const parsed = codeAnswerResultSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("CODE_ANSWER_OUTPUT_INVALID", "The deep analysis answer does not match its required schema.", 422);
  }
  const answer = parsed.data;
  if (question && !answerMatchesQuestionLanguage(question, answer.answerMarkdown)) {
    throw new AppError("CODE_ANSWER_LANGUAGE_MISMATCH", "The deep analysis answer does not match the current question language.", 422);
  }
  const seen = new Set<string>();
  for (const citation of answer.citations) {
    if (!evidence.manifestPaths.has(citation.path)) {
      throw new AppError("CODE_ANSWER_CITATION_PATH_INVALID", "A deep answer Citation is not present in the immutable Repository Artifact.", 422);
    }
    const source = evidence.sources.get(citation.path);
    if (source === undefined) {
      throw new AppError("CODE_ANSWER_CITATION_SOURCE_UNAVAILABLE", "A deep answer Citation source could not be validated.", 422);
    }
    const key = `${citation.path}\0${citation.lineStart}\0${citation.lineEnd}`;
    if (seen.has(key)) throw new AppError("CODE_ANSWER_CITATION_DUPLICATE", "A deep answer contains a duplicate Citation.", 422);
    seen.add(key);
    let expectedHash: string;
    try {
      expectedHash = citationContentHash(source, citation.lineStart, citation.lineEnd);
    } catch {
      throw new AppError("CODE_ANSWER_CITATION_RANGE_INVALID", "A deep answer Citation range is invalid.", 422);
    }
    if (expectedHash !== citation.contentHash) {
      throw new AppError("CODE_ANSWER_CITATION_HASH_INVALID", "A deep answer Citation does not match the immutable Repository source.", 422);
    }
  }
  return answer;
}
