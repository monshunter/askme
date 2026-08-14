export type QuestionLanguage = "en" | "zh-CN";

export function questionLanguage(value: string): QuestionLanguage {
  return /[\u3400-\u9fff]/u.test(value) ? "zh-CN" : "en";
}

export function textMatchesLanguage(language: QuestionLanguage, text: string) {
  const prose = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\b(?:[\w.-]+\/)+[\w.-]+\b/g, " ");
  const han = prose.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  const latinWords = prose.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0;
  if (language === "zh-CN") return han > 0 && han >= latinWords;
  return latinWords > 0 && latinWords * 2 >= han;
}

export function answerMatchesQuestionLanguage(question: string, answer: string) {
  return textMatchesLanguage(questionLanguage(question), answer);
}

export function localizedQuestionMessage(question: string, messages: { en: string; zh: string }) {
  return questionLanguage(question) === "zh-CN" ? messages.zh : messages.en;
}
