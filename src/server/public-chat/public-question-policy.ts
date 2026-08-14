import { assessAgentQuestion } from "@/server/agent/question-policy";

const contextDependentPatterns = [
  /\b(?:it|its|that|this|these|those|them|above|previous|former|latter)\b/i,
  /\b(?:tell me more|go on|elaborate|expand on (?:that|this|it)|more detail)\b/i,
  /(?:这个|这些|那个|那些|它|它们|上述|前面|刚才|展开说说|详细说说|继续说)/,
];

export function isContextDependentPublicQuestion(input: string) {
  return contextDependentPatterns.some((pattern) => pattern.test(input));
}

export function assessPublicQuestion(input: string) {
  return assessAgentQuestion(input);
}
