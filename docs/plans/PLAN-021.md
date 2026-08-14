# PLAN-021：闭环 Agent 回答时间与内容质量

## 目标

让 Candidate 预览和 Public Agent 在当前授权 Evidence 内使用 Host 提供的真实日期回答时间问题，并完整、无语义重复地覆盖用户明确询问的关键方面。

## 范围

本 Plan 修订普通 RAG 问答的长期合同、回答生成与 Host 校验、定向自动化、质量评估和真实 Candidate/Public 验收；不改变 Evidence 授权、Citation 投影、索引数据语义、Deep Analysis 或 Provider 选择。

## Phase 1：固化回答质量合同

- [SPEC-002：Repository Knowledge 与 Hybrid Agentic RAG V2](../specs/SPEC-002.md)
- [DESIGN-005：Repository Knowledge 与 Hybrid Agentic RAG V2](../architecture/DESIGN-005.md)

- [x] 1.1 明确当前日期、问题方面覆盖、缺口披露与语义去重的产品行为
- [x] 1.2 对账 V2 回答组件职责、失败语义与验证边界

## Phase 2：建立回答质量保护

- [x] 2.1 用失败测试覆盖真实日期、复合问题完整性和重复 Claim 拒绝
- [x] 2.2 扩充可重复执行的回答质量评估场景

## Phase 3：实现时间与内容质量控制

- [x] 3.1 将 Host 当前日期和结构化问题方面传入有界回答链路
- [x] 3.2 实现最终 Claim 的方面覆盖、顺序、去重和缺口校验
- [x] 3.3 保持 Claim Verifier、Citation、语言与权限不变量

## Phase 4：验证并收口交付

- [x] 4.1 通过定向测试、类型检查与相关回归
- [x] 4.2 在真实 Candidate/Public 问答中验收时间正确、内容完整且不重复
- [x] 4.3 完成 Change Review、文档对账与原子 Commit
