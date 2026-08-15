import { localizedQuestionMessage } from "./question-language";

export type QuestionRefusalCode = "INVALID_QUESTION" | "QUESTION_INJECTION" | "QUESTION_DATA_EXFILTRATION" | "QUESTION_OUT_OF_SCOPE";

export type QuestionAssessment =
  | { allowed: true; question: string }
  | { allowed: false; code: QuestionRefusalCode; message: string };

const injectionPatterns = [
  /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|system|developer)?\s*(?:instructions|rules|prompt)/i,
  /(?:show|reveal|print|repeat|return).{0,80}(?:system|developer)\s+(?:prompt|instructions)/i,
  /(?:jailbreak|developer\s+mode|bypass.{0,30}(?:guard|rule|instruction))/i,
  /忽略.{0,30}(?:指令|规则|提示词)|输出.{0,30}(?:系统提示|开发者指令)/,
];

const exfiltrationPatterns = [
  /(?:api\s*key|password|secret|access\s*token|cookie|environment\s+variables?)/i,
  /(?:entire|full|complete|all).{0,40}(?:knowledge\s*base|database|source\s*(?:files?|documents?)|private\s+data)/i,
  /(?:download|export|dump).{0,40}(?:sources?|files?|documents?|knowledge|database)/i,
  /(?:密钥|密码|令牌|环境变量|完整.{0,20}知识库|全部.{0,20}资料|导出.{0,20}(?:文件|数据库))/,
];

const sensitiveEvidencePatterns = [
  /\b(?:salary|compensation|bonus|home address|passport(?: number)?|medical record|health (?:information|data)|private interview notes?|agent-only|unauthorized)\b/i,
  /(?:私人薪酬|薪资|工资|奖金|家庭住址|住址|护照(?:号码)?|私人病史|病史|健康信息|私人面试记录|仅 Agent|未授权)/,
];

function isDirectSensitiveEvidenceRequest(question: string) {
  if (!sensitiveEvidencePatterns.some((pattern) => pattern.test(question))) return false;
  const clauses = question.split(/\b(?:and|as well as|along with)\b|(?:以及|并且|同时|和|及)/iu).map((clause) => clause.trim()).filter(Boolean);
  return clauses.length === 1 || clauses.every((clause) => sensitiveEvidencePatterns.some((pattern) => pattern.test(clause)));
}

const outOfScopePatterns = [
  /\b(?:weather|forecast|recipe|sports score|stock price|politics|horoscope|medical diagnosis|legal advice)\b/i,
  /(?:天气|菜谱|食谱|比分|股价|星座|医疗诊断|法律建议)/,
];

export function assessAgentQuestion(input: string): QuestionAssessment {
  const question = input.replace(/\s+/g, " ").trim();
  if (!question || question.length > 500 || !/[\p{L}\p{N}]/u.test(question)) {
    return { allowed: false, code: "INVALID_QUESTION", message: "Ask a question between 1 and 500 characters." };
  }
  if (injectionPatterns.some((pattern) => pattern.test(question))) {
    return { allowed: false, code: "QUESTION_INJECTION", message: localizedQuestionMessage(question, { en: "I can answer career questions, but I cannot follow requests to change or reveal my instructions.", zh: "我可以回答职业相关问题，但不能执行更改或披露自身指令的请求。" }) };
  }
  if (exfiltrationPatterns.some((pattern) => pattern.test(question)) || isDirectSensitiveEvidenceRequest(question)) {
    return { allowed: false, code: "QUESTION_DATA_EXFILTRATION", message: localizedQuestionMessage(question, { en: "I can answer from authorized evidence, but I cannot reveal secrets, private data, or the full knowledge base.", zh: "我可以根据授权证据回答，但不能披露密钥、私有数据或完整知识库。" }) };
  }
  if (outOfScopePatterns.some((pattern) => pattern.test(question))) {
    return { allowed: false, code: "QUESTION_OUT_OF_SCOPE", message: localizedQuestionMessage(question, { en: "I can answer questions about this candidate's career evidence, projects, experience, and skills.", zh: "我可以回答与这位候选人的职业证据、项目、经历和技能有关的问题。" }) };
  }
  return { allowed: true, question };
}
