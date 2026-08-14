# REVIEW-085：SPEC-002 问答语言与 LLM 推荐增量 Spec Review

## 审查对象

- Plan：[PLAN-016](../plans/PLAN-016.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Revision：`SPEC-002 sha256:d330740ba3442b534f932bcc9ab940d3e30a6e67c98ded75260a2ddb46efe814`
- 审查日期：2026-08-14

## 审查结论

- “同语言”同时覆盖 RAG、Deep、证据不足、拒绝与推荐 refresh，并为源码标识符和专有名词保留必要原文边界。
- 非空会话明确要求 LLM 使用完整可见上下文和授权主题生成推进聊天的问题；预定义轮换不再是正常路径，fallback 只在模型失败时生效。
- `AC-LANGUAGE-001` 与 `AC-SUGGEST-001` 可以用中英文双场景、上下文版本、LLM usage 与浏览器结果独立验证。

## 结论

`PASS`
