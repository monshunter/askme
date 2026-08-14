# REVIEW-082：SPEC-002 Agent 精准问答与会话推荐增量 Spec Review

## 审查对象

- Objective：`OBJ-011`
- Plan：[PLAN-016](../plans/PLAN-016.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Revision：`SPEC-002 sha256:73540f78009adc94bc09e82240815c0bfddd000a7976487ff5789c8e2c712e77`
- 审查日期：2026-08-14

## 一致性与边界

- Spec 把 Repository 识别、section 检索、回答选用 Evidence 与最终源码 Citation 分成连续但不同的合同，明确禁止用“同仓库”或同 section 的全部 marker 冒充实际来源。
- `rag/deep/refuse` 的有效路由、真实 `conversation_analysis` 与离线 `repository_analysis` 被明确区分；Deep 验收不能由 Router 调用、Wiki 生成或 readiness 替代。
- “不限制次数”只作用于 Agent 问答和 Conversation Deep；短窗口滥用防护、并发、单次运行预算与离线 Wiki 运维资源控制仍由 Host 强制。未来 Token/积分余额保持为独立延迟合同，没有伪造当前计费行为。
- 推荐问题明确属于具体 Conversation，覆盖空会话引导、全部可见上下文、回答后更新、主动刷新、同语言与失败 fallback，没有继续把全局 Agent Settings 或随机题库当作状态 owner。

## 可验收性

- `AC-ANSWER-001` 以固定 copybook 概览问题和无关入口组件来源作为负例，可由单元、数据库与浏览器三层直接验收。
- `AC-DEEP-001` 要求路由审计、数据库 run、worker/microVM 与最终源码 Citation 同时成立，运行 Evidence 边界充分。
- `AC-USAGE-001` 可以通过配置/API surface、日配额预置值、usage 表增量与真实 Candidate/Public 请求验证。
- `AC-SUGGEST-001` 可以通过两个会话隔离、空会话、多轮上下文、RAG/Deep 终态与 refresh 版本验证。

## 结论

`PASS`

下一路由：审查 [DESIGN-005](../architecture/DESIGN-005.md) 的状态 owner、失败语义、迁移和验证设计。
