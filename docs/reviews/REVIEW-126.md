# REVIEW-126：SPEC-002 Query Clarification 结果模型 Reconcile Review

被审制品：`SPEC-002`

Revision：`sha256:e2169af968224d534d9c405acdaf67686c1a27210b90e061259261c9e4625d15`

Verdict：`PASS`

替代关系：本 Review 替代绑定上一 revision 的 [REVIEW-125](REVIEW-125.md)；Agentic Query Understanding 结论不变，仅收敛澄清结果模型。

## 审查结论

- 当前 Preview/Public 消息、风险投影与持久化统一使用 `answered | refused | insufficient_evidence`，新增顶层 outcome 会扩大数据库/API/UI 契约，而用户目标只要求准确识别和反馈真实意图。
- 最终合同沿用 `insufficient_evidence`，以稳定 `query_clarification_required` reason、Retrieval Trace 和专用澄清文案区分真实知识缺口；不会把歧义伪装成资料不存在，也不会触发未知 Repository 的 Deep fallback。
- 该收敛不改变 Query Understanding Agent、受控上下文、两阶段语义裁决、Required/Context entity role、focused/discovery/clarify、时间 overlap 或评测门禁。
- 方案复用现有持久数据模型和错误投影，删除一项不必要 migration/API 分支，仍可由单元、API 与真实浏览器独立验收。

下一路由：更新并审查 `DESIGN-005`。
