# REVIEW-086：DESIGN-005 问答语言与 LLM 推荐增量 Design Review

## 审查对象

- Plan：[PLAN-016](../plans/PLAN-016.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- Revision：`DESIGN-005 sha256:ec538146d06ae0c432e9498db4903e5be65c9338b62a5a95fbf000c5210c2810`
- 审查日期：2026-08-14

## 审查结论

- 最后一条用户问题是有上下文会话的语言 owner，空会话才回退 UI locale；语言同时进入 context hash，切换语言不会复用旧推荐。
- 推荐模型使用已有 Router profile 和结构化四问题 schema，不新增外部依赖；optimistic hash 防止慢结果覆盖新会话，失败 fallback 不影响已完成回答。
- RAG system contract 与 Code Q&A Skill 分别承担同步、深度回答语言要求，Host 继续拥有授权、结构和 Citation 校验。

## 结论

`PASS`
