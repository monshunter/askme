# REVIEW-034：PLAN-009 Design Review

## 审查对象

- 制品：`DESIGN-001`、`DESIGN-003`
- Revision：`HEAD 7ce39ec + REVIEW-033 PASS + PLAN-009 design working tree`
- 上层 Objective：`OBJ-004`
- 行为合同：[根产品规格](../../SPEC.md)、[SPEC-001](../specs/SPEC-001.md)
- Plan Review 决策：`askme-mvp-system` 与 `askme-ui-i18n-a11y` 均为 `UPDATE`
- 审查日期：2026-08-12

## 发现

- `DESIGN-001` 继续拥有全栈组件与路由边界，`DESIGN-003` 继续拥有 UI、双语和可访问性边界；两者的 Boundary ID 和 Owner boundary 正交且没有重复 active owner。
- `/workspace/agent` 以 Server Component 聚合 preview thread、Agent settings 与 publication overview，客户端只消费既有领域服务/API；publication service、持久状态和公共权限继续是单一事实源。
- 退役对象限定为 `/workspace/publish`、`/workspace/publish/preview`、页面专用客户端与恢复辅助，不删除 Agent 页面继续依赖的 publication API/domain service，也不需要 migration。
- Candidate Shell 删除第二语言入口、Quick Action、邀请卡和发布导航后职责更窄；页面 footer 继续复用现有 `LanguageSwitcher`，没有引入第二份 locale 状态。
- 失败反馈、发布 readiness、撤销确认和公共权限仍沿用既有边界；回滚只需恢复页面消费者与导航，不涉及持久数据恢复。

## 结论

`PASS`

下一路由：进入 Phase 2，先按 `AC-AGENT-004` 与 `AC-UI-004` 建立失败测试，再实施最小收敛。
