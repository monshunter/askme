export type QuestionRefusalCode = "INVALID_QUESTION" | "QUESTION_INJECTION" | "QUESTION_DATA_EXFILTRATION";

export type QuestionAssessment =
  | { allowed: true; question: string }
  | { allowed: false; code: QuestionRefusalCode; message: string };

const injectionPatterns = [
  /ignore\s+(?:all\s+)?(?:previous|prior|system|developer)?\s*(?:instructions|rules|prompt)/i,
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

export function assessAgentQuestion(input: string): QuestionAssessment {
  const question = input.replace(/\s+/g, " ").trim();
  if (!question || question.length > 500 || !/[\p{L}\p{N}]/u.test(question)) {
    return { allowed: false, code: "INVALID_QUESTION", message: "Ask a question between 1 and 500 characters." };
  }
  if (injectionPatterns.some((pattern) => pattern.test(question))) {
    return { allowed: false, code: "QUESTION_INJECTION", message: "I can answer career questions, but I cannot follow requests to change or reveal my instructions." };
  }
  if (exfiltrationPatterns.some((pattern) => pattern.test(question))) {
    return { allowed: false, code: "QUESTION_DATA_EXFILTRATION", message: "I can answer from authorized evidence, but I cannot reveal secrets, private data, or the full knowledge base." };
  }
  return { allowed: true, question };
}
