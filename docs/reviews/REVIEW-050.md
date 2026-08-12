# REVIEW-050：来源文件访问与 Markdown 体验 Design Review

## 审查对象

- Objective：`OBJ-007`
- Plan：[PLAN-012](../plans/PLAN-012.md)
- Spec：[SPEC-001](../specs/SPEC-001.md)
- Design：[DESIGN-001](../architecture/DESIGN-001.md)、[DESIGN-003](../architecture/DESIGN-003.md)
- Revision：`feat/markdown-source-preview` 当前 Design Diff
- 审查日期：2026-08-12

## 契约、安全与复杂度

- 方案复用 `materials.visibility`、publication 与 owner 事实，不新增数据库字段、权限枚举、对象存储或公开 token，避免第二套授权状态和 migration 风险。
- Candidate 与 public 使用独立 Route Handler 入口但共享 material 内容读取边界；Candidate 请求绑定 session owner，公共请求同时绑定当前 publication owner、`indexed` 与 `public_preview`。
- 公共 Citation 只投影名称和可选访问描述，数据库 `storage_path`、Citation `excerpt`、类型与摘要不进入公共响应；旧 URL 每次重新授权，visibility/publication 变化可以即时止损。
- 本地文件保持服务端读取并设置 `inline`、`nosniff`、`no-store`；外部来源只在 `public_preview` 时使用原公开 URL，没有服务端代理任意外部地址的新 SSRF 面。
- CommonMark/GFM 使用成熟渲染器且不启用 raw HTML；同一共享 viewer 承担 Markdown/PDF dialog、焦点、失败和移动约束，没有按页面复制预览实现。

## 失败、兼容与回滚

- 未授权、跨 owner、暂停/撤销 publication 与不存在文件统一失败，不泄露先前访问状态；文件缺失只影响当前请求，不改变数据库或派生知识。
- 变更不修改既有消息、Citation、material 数据或 slug；旧 Chat 记录可由新投影即时获得当前访问能力。
- 回滚可移除新 Route Handler、共享渲染/预览组件和投影字段；没有 schema 或数据回滚步骤。

## 结论

`PASS`

下一路由：进入 `PLAN-012` Phase 2/3，使用 TDD 先建立页眉、Markdown、投影与权限回归，再实施共享内容能力。
