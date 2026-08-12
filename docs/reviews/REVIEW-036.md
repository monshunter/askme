# REVIEW-036：全局语言入口 Spec Review

## 审查对象

- 制品：[SPEC-001](../specs/SPEC-001.md)
- Boundary ID：`askme-mvp-product`
- 变更：新增全站右上角唯一语言切换行为与 `AC-UI-005`
- 审查日期：2026-08-12

## 一致性

- 新行为沿用已批准的 English / 简体中文、`askme_locale` 持久化和匿名 locale API，不改变 `AC-I18N-001` 的语言语义。
- “全部产品页面”“登录前后”“右上角”“只有一个”“页面、footer、账号菜单无第二入口”分别锁定覆盖范围、身份边界、位置与唯一性，不再与原 Candidate footer 入口表述冲突。
- `AC-UI-004` 继续拥有 Candidate Shell 清理，`AC-UI-005` 独立拥有全站语言入口，两个验收项可分别失败和修复。

## 完备性与可测试性

- 自动化可通过根布局唯一 import/实例、页面 SSR 与匿名 locale API 证明结构和持久化。
- 真实浏览器可在登录页、Candidate、公共 Agent 和 Admin 代表页面检查右上角位置、唯一可见控件、切换刷新、顶栏重叠和移动横向 overflow。
- cookie/API 失败、权限、用户业务数据与路由均保持现有合同，新增行为没有隐含数据库或认证要求。

## 结论

`PASS`

下一路由：审查 `DESIGN-001` 与 `DESIGN-003` 的根布局 owner 和响应式投影。
