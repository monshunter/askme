# REVIEW-035：PLAN-009 范围调整 Plan Review

## 审查对象

- 制品：`PLAN-009`
- Revision：`HEAD 7ce39ec + PLAN-009 implementation working tree`
- 上层 Objective：`OBJ-004`
- 范围变化：语言切换从 Candidate 页面级唯一入口提升为登录前后全部页面共用的右上角全局设置
- 审查日期：2026-08-12

## 发现

- 新要求改变 UI/i18n 的跨页面边界，但不改变 locale cookie、匿名 locale API、业务数据、权限或发布领域契约；在现有 Standard Objective 内扩展 Plan 是最小充分路径。
- Plan 新增合同对齐与根布局实施两个原子 Item，并重新打开场景对账；已完成的 Agent 合并、路由退役和 Candidate Shell 清理仍然有效，不需重做。
- 根布局是所有产品路由的共同祖先，适合拥有唯一 `LanguageSwitcher`；页面、footer 和账号菜单删除实例后不会产生第二份 locale 状态。
- 右上角固定入口会影响 Candidate、Public 与 Admin 顶栏及移动断点，因此必须用桌面与 `430 × 932` 真实浏览器检查可见性、重叠和横向 overflow。

## Spec/Design decision matrix

| Type | Boundary ID | Decision | Target | Reason |
|---|---|---|---|---|
| Spec | `askme-product-direction` | REFERENCE | [根产品规格](../../SPEC.md) | Agent 单一入口方向未变化，新增全局语言放置由 MVP UI 合同拥有 |
| Spec | `askme-mvp-product` | UPDATE | [SPEC-001](../specs/SPEC-001.md) | 全站唯一、登录无关和右上角位置是外部可验收产品行为 |
| Design | `askme-mvp-system` | UPDATE | [DESIGN-001](../architecture/DESIGN-001.md) | 根布局与各 Shell 的语言入口职责需要重新划分 |
| Design | `askme-ui-i18n-a11y` | UPDATE | [DESIGN-003](../architecture/DESIGN-003.md) | 全局控件 owner、顶栏保留空间、移动断点和无重复状态属于既有 UI/i18n 边界 |

## 结论

`PASS`

下一路由：完成新增 Spec/Design 条目的定向 Review 后，建立全局唯一入口的失败测试并实施 Phase 2.4。
