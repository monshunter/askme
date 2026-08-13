# REVIEW-077：SPEC-002 统一知识浏览增量 Spec Review

## 审查对象

- Objective：`OBJ-010`
- Plan：[PLAN-015](../plans/PLAN-015.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Revision：`SPEC-002 sha256:f709815f708e04d5ebdf376034d1a46878369f0e419d998c838d623a46fb82ed`
- 审查日期：2026-08-14

## 一致性与边界

- 增量继续由 `SPEC-002` 拥有 Repository Wiki 语义，没有新建与 `SPEC-001` Career Knowledge Base 冲突的平行合同。
- Repository 与 Material/Knowledge Item 仍是独立聚合，只在长期知识浏览和 Evidence 层统一；Repository Wiki 保持只读，编辑仍由审核投影 owner 承担。
- current active Approved、旧 active 延续、pending/generated/superseded/disabled/private 隔离和实时 Deep Analysis 不回写均有明确行为，不会用页面展示扩大授权。

## 可测试性

- `AC-KB-003` 使用稳定 ID，能够分别由列表/计数/搜索/详情 API、Candidate 浏览器、Candidate Preview/Public Chat 与源码 Citation Evidence 验证。
- 一 Repository 一条、Wiki 页面留在详情、现有 `type=repository` Knowledge Item 共存和来源类型区分均为可观察结果，没有依赖实现内部状态作为唯一验收。

## 结论

`PASS`

下一路由：审查 [DESIGN-005](../architecture/DESIGN-005.md) 的统一只读投影方案。
