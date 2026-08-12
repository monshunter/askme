# REVIEW-033：PLAN-009 Spec Review

## 审查对象

- 制品：`SPEC.md`、`SPEC-001`
- Revision：`HEAD 7ce39ec + PLAN-009 contract working tree`
- 上层 Objective：`OBJ-004`
- Plan Review 决策：`askme-product-direction` 与 `askme-mvp-product` 均为 `UPDATE`
- 审查日期：2026-08-12

## 发现

- 两份既有 Spec 已分别声明稳定 Boundary ID、Owner boundary 与 active 状态；根产品方向拥有长期定位和一级信息架构，`SPEC-001` 拥有 MVP 可验收行为，没有创建第三份平行合同。
- 根信息架构与 MVP 能力已收敛为单一 Agent 入口，`SPEC-001` 明确英文 `Agent`、中文 `智能体`，并把预览、设置、发布、公开访问和撤销定义为同页闭环。
- Candidate Shell 的唯一语言入口、移除 Quick Action / 快捷操作与 Invite Interviewers / 邀请面试官均为外部可观察行为，并由新增 `AC-AGENT-004`、`AC-UI-004` 独立验收。
- Spec 保留 publication 状态、公开权限、Admin 治理、公共问答和数据库语义；退役范围只包括独立 Candidate 发布页面，不会把 UI 合并误写成发布领域删除。
- 旧 `/workspace/publish` 与 `/workspace/publish/preview` 的退役行为明确，不依赖实现细节即可通过路由与浏览器验证。

## 结论

`PASS`

下一路由：按 Plan Review 的 Design `UPDATE` 决策审查最小系统收敛方案。
