# REVIEW-022：DESIGN-003 Design Review

## 审查对象

- 制品：`DESIGN-003`
- Revision：`HEAD 246c5a9 + DESIGN-003 working tree（实现前）`
- 上层 Plan：[PLAN-005](../plans/PLAN-005.md)
- 行为合同：[SPEC-001](../specs/SPEC-001.md) `AC-UI-001`–`003`、`AC-I18N-001`
- 审查日期：2026-08-11

## 审查范围

- 七张参考图、真实路由和数据 owner 的覆盖。
- Locale 唯一状态、API、SSR/Client 一致性和兼容性。
- 翻译边界、视觉/响应式、键盘与语义合同。
- 失败、恢复、成本、迁移和回滚。

## 发现

### 边界与事实源

- 七张参考图都绑定到当前真实路由，其中 `frontend_index.png` 明确归属 Platform Admin；动态姓名、计数、回答和资料不被设计稿样例替换。
- Locale 只有 `askme_locale` cookie 一个持久化 owner；catalog、Server locale reader 和 `LanguageSwitcher` 分工清楚，没有同时使用 URL、数据库、Context 或 `localStorage` 形成多真理源。
- 用户数据、AI 回答、Citation 和外部内容不翻译，固定 UI 与错误码显示映射翻译，边界符合数据真实性与审计要求。

### 契约与一致性

- 匿名 `PUT /api/preferences/locale` 只写非敏感同源偏好，不改变 session 或业务数据；稳定 URL 保留 opaque public link 和既有导航兼容性。
- Root Layout、Server Component、Client 初始 props 共用 request cookie，切换成功后再 `router.refresh()`，可以避免 hydration 后整页替换和同一首屏混用语言。
- 无效 cookie、无效输入、接口失败、未知错误码和缺失 catalog key 均有明确回退；日期/数字指定 locale 与 UTC，覆盖现有 hydration 风险。

### 视觉、移动与可访问性

- 设计把视觉比较限定为结构、几何、层次、操作和响应式顺序，允许真实动态内容纵向增长，不会为截图隐藏产品事实。
- 430 × 932 的 drawer、表格/矩阵投影、公共 Chat 顺序和输入可达性都有合同；固定侧栏、顶栏和资产 owner 与当前 CSS/参考图一致。
- Skip link、`focus-visible`、label、dialog、aria-live、非颜色状态和完整键盘链路均可直接验证，且没有引入正 `tabIndex` 或平行交互模型。

### 成本、恢复与回滚

- 两种 locale 不需要第三方 runtime 或数据库 migration；类型化 catalog 是当前最小充分方案。
- cookie 偏好是浏览器级持久化，不跨设备或跨浏览器同步；Spec 只要求选择持久化，没有要求账号同步，因此这不是阻塞。若未来需要账号同步，应作为独立数据语义变更设计。
- 删除 locale handler/catalog/switcher 后旧 cookie 可被忽略，回滚不修改数据和公共 URL；视觉 CSS 可按选择器回退。

## 结论

`PASS_WITH_NOTES`

Notes：浏览器级 locale 持久化满足当前合同但不提供跨设备同步；实现阶段必须用 catalog key parity、SSR cookie 测试和真实刷新 Evidence 防止大范围翻译遗漏。两项均已被 DESIGN-003 验证计划覆盖，不阻塞实施。

下一路由：按 PLAN-005 Phase 2 从 locale core、Route Handler、Root Layout 和共享切换器开始实施，再依次覆盖共享入口、Candidate、公共 Agent 和 Platform Admin。
