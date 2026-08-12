# REVIEW-038：PLAN-009 中文品牌范围调整 Plan Review

## 审查对象

- 制品：`PLAN-009`
- Revision：`HEAD 7ce39ec + PLAN-009 implementation working tree`
- 上层 Objective：`OBJ-004`
- 范围变化：Askme 中文名由旧“问候”统一为“职问”
- 审查日期：2026-08-12

## 发现

- 新要求改变长期产品名称和全站 UI 品牌标记，但不改变英文名 Askme、业务行为、API、数据、权限或运行环境；在现有 Standard Objective 内扩展产品合同和 UI 设计最直接。
- Plan 新增一个合同 Item 和一个全站实现 Item；Agent 合并与全局语言入口的已完成工作仍成立。
- 当前 `rg` 证明旧品牌分布在登录、Candidate、公共 Agent、Admin、邀请和不可用页面；用源代码全局保护加代表路由浏览器验收可以覆盖替换完整性。

## Spec/Design decision matrix

| Type | Boundary ID | Decision | Target | Reason |
|---|---|---|---|---|
| Spec | `askme-product-direction` | UPDATE | [根产品规格](../../SPEC.md) | 中文产品名属于长期产品身份 |
| Spec | `askme-mvp-product` | UPDATE | [SPEC-001](../specs/SPEC-001.md) | 全部页面可见品牌名与验收边界属于 MVP 外部行为 |
| Design | `askme-mvp-system` | UPDATE | [DESIGN-001](../architecture/DESIGN-001.md) | 本 Plan 已将 Candidate Agent 页面、Shell 与 publication 服务的职责收敛为单一入口 |
| Design | `askme-ui-i18n-a11y` | UPDATE | [DESIGN-003](../architecture/DESIGN-003.md) | wordmark、印章、双语显示和视觉验收属于现有 UI owner |

## 结论

`PASS`

下一路由：完成根 Spec / `SPEC-001` 与 `DESIGN-003` 的定向审查，随后建立旧品牌残留的失败测试并实施替换。
