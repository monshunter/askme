# REVIEW-037：全局语言入口 Design Review

## 审查对象

- 制品：[DESIGN-001](../architecture/DESIGN-001.md)、[DESIGN-003](../architecture/DESIGN-003.md)
- Boundary ID：`askme-mvp-system`、`askme-ui-i18n-a11y`
- 变更：由根布局唯一渲染 `LanguageSwitcher`，各 Shell、页面与 footer 只消费 locale
- 审查日期：2026-08-12

## 边界与依赖

- `RootLayout` 是登录、Candidate、公共 Agent、Admin 与邀请页面的共同祖先，拥有唯一控件不会产生角色依赖；控件继续只调用允许匿名访问的 locale API。
- locale cookie 仍是唯一持久化 owner，页面和 Client Component 只接收服务端 locale，不新增 Context、`localStorage` 或用户数据库字段。
- Candidate Agent 合并与 publication service 边界不受影响；全局入口只改变 UI 放置和各 Shell 的布局保留空间。

## 状态、失败与恢复

- pending、失败提示和成功后的 `router.refresh()` 继续由现有 `LanguageSwitcher` 拥有；失败不会改变当前语言或业务页面状态。
- 页面移除实例是可逆 UI 变更，根布局回滚后既有 cookie 可安全忽略，不需要 migration 或数据恢复。
- 顶栏重叠和移动横向 overflow 是主要新增风险，设计已要求 Candidate、Public、Admin 顶栏为固定右上角控件保留空间，并用 `1448 × 1086` 与 `430 × 932` 验收。

## 复杂度

- 复用现有组件、locale API、cookie 与 server locale，不新增依赖或并行状态；根布局一个 owner 是满足“所有页面且唯一”的最小结构。

## 结论

`PASS`

下一路由：建立根布局唯一实例与页面零实例的失败测试，再实施 `PLAN-009` Phase 2.4。
