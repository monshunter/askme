# REVIEW-023：PLAN-005 Change Review

## 审查对象

- 制品：`PLAN-005` 当前完整工作树
- Revision：`HEAD 246c5a9 + feat/askme-mvp-full-loop working tree（提交前）`
- 上层 Objective：`OBJ-001`
- 审查日期：2026-08-11

## 审查范围

- 七张 `asserts/images/` 主界面对应的 Platform Admin、Candidate 与公共 Agent 页面。
- English / 简体中文语言状态、匿名与登录后持久化、SSR 一致性、操作反馈和错误状态。
- `AC-UI-001`–`003`、`AC-I18N-001`，以及导航、表单、隐私控制、Chat 和治理对话框的关键可访问性。

## 新鲜 Evidence

- `npm run typecheck`、`npm run lint`、`git diff --check` PASS；40 test files / 134 tests PASS。
- Docker production build PASS；使用新镜像重建 Web/Worker 后，`/api/health/ready` 返回 database、migration、worker `ready`，AI `configured`，数据库与持久卷未重置。
- Chrome 真实切换 English → 简体中文后，`html[lang]`、Candidate/Admin 导航、页面标题、指标、空态、反馈与 footer 同步更新；刷新后仍为 `zh-CN`，且 `askme_locale` 为脚本不可见的 HTTP-only Cookie。公共 Agent 可独立切回 English，路由与对话状态未丢失。
- 七张参考界面均完成 1448 × 1086 对照；Candidate、Admin 与公共页面 document `scrollWidth` 等于 viewport，水墨背景、纸张卡片、侧栏/顶栏、标题印章、表格/Chat/引用结构与参考视觉语言一致，真实数据差异未用静态样例填充。
- 可见 DevTools 选择 `iPhone 14 Pro Max`，Chrome 实测 `innerWidth=430`、`innerHeight=932`。Admin、公共 Agent 以及 Candidate 工作台、资料、知识、隐私、Agent、发布页均 `scrollWidth=430`；移动导航、表单、隐私选择与 Chat 可达。
- 键盘实测首个 Tab 聚焦“跳到主要内容”，Enter 将焦点移到 `main-content`；`⌘K` 聚焦全局搜索；移动导航可展开并通过链接关闭；Chat textarea 与发送按钮具有关联 label/aria-label。
- 治理与资料删除对话框实测初始焦点、Tab/Shift+Tab 环回、Escape 关闭和触发按钮焦点恢复全部成立；未执行实际暂停、删除或撤销动作。
- 浏览器首次发现的未生成链接直达公开预览错误已修订为安全重定向 `/workspace/publish` 并增加回归测试；首次发现的 React hydration 日志已通过统一 Client Component 首屏 UTC 格式化修复。全新 Chrome 标签页依次打开 Agent Preview、Publish 与真实公共 Agent，warning/error 日志均为 `[]`。

## 发现

- 语言只有一个 Cookie owner；Server Component 决定首屏 locale 并向 Client Component 下发同一值，切换成功后再 `router.refresh()`，没有双状态竞争、页面跳转或乐观文案闪烁。
- 固定 UI 文案来自类型化双语 catalog；用户资料、知识、Citation、AI 回答和治理安全摘要保持原始数据，不被翻译层伪造或改写。
- Admin 指标、目录、报表、审核与运行状态继续来自 PostgreSQL/API；Candidate 资料、知识、隐私、Agent 与发布流程继续使用既有真实数据合同，没有新增 mock、静态业务数据或伪成功。
- 自定义对话框现在由同一焦点守卫管理初始焦点、Tab 边界、Escape 与焦点恢复；`prefers-reduced-motion`、可见 `:focus-visible`、skip link 和搜索快捷键形成一致的共享交互合同。
- 公开预览在缺少 publication link 时只恢复到当前 Candidate 的发布管理，不吞掉数据库或其他未知错误。

未发现影响 `AC-UI-001`–`003`、`AC-I18N-001`、数据完整性、隐私边界、角色授权、响应式或 Docker 交付的缺陷。

## 结论

`PASS`

下一路由：`autogo-change-close`，完成 Plan、索引、Progress 与原子 Commit 对账；随后继续同一 Objective 的运行与可观测性、from-zero/restart 和最终总验收。
