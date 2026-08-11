type KnowledgeType = "project" | "experience" | "skill" | "article" | "repository" | "summary";

export type SuggestionKnowledgeItem = { type: KnowledgeType; title: string };

function normalizeTitle(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

function primaryQuestion(item: SuggestionKnowledgeItem) {
  const title = normalizeTitle(item.title);
  if (!title) return null;
  switch (item.type) {
    case "project":
      return `What did you build in ${title}?`;
    case "experience":
      return `What impact did you have in ${title}?`;
    case "skill":
      return `How have you applied ${title}?`;
    case "repository":
      return `What does the ${title} repository demonstrate?`;
    case "article":
      return `What insight does ${title} demonstrate?`;
    case "summary":
      return `Can you summarize ${title}?`;
  }
}

function questionCandidates(items: SuggestionKnowledgeItem[]) {
  const grounded = items
    .map((item) => ({ primary: primaryQuestion(item), title: normalizeTitle(item.title) }))
    .filter((item): item is { primary: string; title: string } => Boolean(item.primary && item.title));
  const candidates = [
    ...grounded.map((item) => item.primary),
    ...grounded.map((item) => `What evidence supports ${item.title}?`),
    ...grounded.map((item) => `Can you summarize the evidence about ${item.title}?`),
    ...grounded.map((item) => `What does ${item.title} demonstrate?`),
  ];
  return [...new Set(candidates)].filter((question) => question.length <= 180);
}

export function buildSuggestedQuestionsAtOffset(items: SuggestionKnowledgeItem[], offset: number) {
  const unique = questionCandidates(items);
  const start = unique.length === 0 ? 0 : ((Math.max(0, Math.trunc(offset)) % unique.length) + unique.length) % unique.length;
  return Array.from({ length: Math.min(4, unique.length) }, (_, index) => unique[(start + index) % unique.length]!);
}

export function buildSuggestedQuestions(items: SuggestionKnowledgeItem[], current: string[]) {
  const unique = questionCandidates(items);
  const currentStart = current[0] ? unique.indexOf(current[0]) : -1;
  const start = currentStart >= 0 ? (currentStart + 1) % unique.length : 0;
  return buildSuggestedQuestionsAtOffset(items, start);
}
