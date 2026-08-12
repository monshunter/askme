# REVIEW-039：Askme 中文品牌 Spec Review

## 审查对象

- 制品：[根产品规格](../../SPEC.md)、[SPEC-001](../specs/SPEC-001.md)
- Boundary ID：`askme-product-direction`、`askme-mvp-product`
- 变更：Askme 唯一中文名确定为“职问”，新增 `AC-UI-006`
- 审查日期：2026-08-12

## 一致性与边界

- 根 Spec 明确英文代号 Askme 与中文名“职问”，没有重命名代码包、URL、API 或英文产品标识。
- `SPEC-001` 将登录前后全部产品页面纳入可见品牌边界，并明确旧“问候”不得继续作为品牌名；普通正文词组不受影响。
- `AC-UI-006` 可独立于 Agent 合并和全局语言入口验收，不会用局部页面通过替代全站完成。

## 可测试性

- 源代码检查可证明全部 TSX 品牌标记不再包含精确旧名称并至少包含“职问”。
- 真实浏览器可在登录、Candidate Agent、公共 Agent 与 Admin 代表页面验证 `Askme` / “职问”组合和 hero 印章。

## 结论

`PASS`

下一路由：审查 `DESIGN-003` 的视觉投影和替换边界。
