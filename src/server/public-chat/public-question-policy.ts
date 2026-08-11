import { assessAgentQuestion } from "@/server/agent/question-policy";

const outOfScopePatterns = [
  /\b(?:weather|forecast|recipe|sports score|stock price|politics|horoscope|medical diagnosis|legal advice)\b/i,
  /(?:天气|菜谱|食谱|比分|股价|星座|医疗诊断|法律建议)/,
];

const contextDependentPatterns = [
  /\b(?:it|its|that|this|these|those|them|above|previous|former|latter)\b/i,
  /\b(?:tell me more|go on|elaborate|expand on (?:that|this|it)|more detail)\b/i,
  /(?:这个|这些|那个|那些|它|它们|上述|前面|刚才|展开说说|详细说说|继续说)/,
];

export function isContextDependentPublicQuestion(input: string) {
  return contextDependentPatterns.some((pattern) => pattern.test(input));
}

export function assessPublicQuestion(input: string) {
  const base = assessAgentQuestion(input);
  if (!base.allowed) return base;
  if (outOfScopePatterns.some((pattern) => pattern.test(base.question))) {
    return {
      allowed: false as const,
      code: "QUESTION_OUT_OF_SCOPE" as const,
      message: "I can answer questions about this candidate's career evidence, projects, experience, and skills.",
    };
  }
  return base;
}
