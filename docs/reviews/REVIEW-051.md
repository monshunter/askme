# REVIEW-051：PLAN-012 Change Review

## 审查对象

- Objective：`OBJ-007`
- Plan：[PLAN-012](../plans/PLAN-012.md)
- Spec：[SPEC-001](../specs/SPEC-001.md)
- Design：[DESIGN-001](../architecture/DESIGN-001.md)、[DESIGN-003](../architecture/DESIGN-003.md)
- Scenario：[SCN-001](../scenarios/SCN-001.md)
- Revision：`HEAD db21e35 + feat/markdown-source-preview working tree`
- 审查日期：2026-08-12

## 正确性、安全与兼容边界

- Candidate 与 Platform Admin Shell 的页眉搜索、快捷操作及共享快捷键 hook 已移除；Candidate 五个一级导航、Admin 六个一级导航、通知与账号入口保持可用，Knowledge 与 Admin Candidates 等领域页面搜索没有被误删。
- Candidate 预览与公开 Agent 的用户消息、回答共用安全 CommonMark/GFM 渲染器；没有启用 raw HTML，外部链接限定新标签页与 `noopener/noreferrer`，多行输入只裁剪首尾空白而不再破坏 Markdown 结构。
- Candidate Dashboard、Materials、Knowledge、Privacy 与 Agent Citation 共用 `CandidateSourceLink`；本地内容 Route Handler 要求 Candidate session 并绑定 `owner_id`，不受 visibility/status 限制，因此 owner 可以查看自己的全部文件，同时不能跨 owner 访问。
- 公开 Citation 服务端响应只保留去重后的 `materialTitle` 和可选 `access`；`citation_allowed` 的 `access` 恒为 `null`，不会投影 excerpt、摘要、类型、内部 ID、storage path 或 URL，`public_preview` 才能获得格式感知的访问描述。
- 公开本地文件 Route Handler 在每次请求时重新校验 active user、public mode、published publication、slug owner、`indexed`、`public_preview` 与 storage owner 边界；visibility 或 publication 撤销后旧 URL 立即失败，没有长期签名地址或缓存绕过。
- Markdown/PDF 在共享、可聚焦、Escape/背景可关闭的居中 dialog 中显示；PDF 使用 `210/297` 比例并按 viewport 等比缩放，Office/TXT 与安全的远程 `http(s)` 来源使用新标签页。响应使用 `inline`、`no-store`/`private, no-store`、`nosniff` 与 same-origin frame/resource 边界。
- Diff 不修改数据库 schema、visibility 枚举、既有消息/Citation 数据、Secret、部署配置或运行中的 Docker 服务；新增依赖仅为 Markdown 渲染，当前 lockfile audit 为 0 vulnerability。

## 当前 Evidence

- 自动化回归：`npm test` 通过，`48 files / 160 tests`；`npm run lint`、`npm run typecheck`、`npm run build` 与 `git diff --check` 通过。production route manifest 包含 Candidate 与公开来源访问 Route Handler。
- Candidate/API：五个来源表面均渲染 owner-scoped 控件；Markdown/PDF 为当前页预览，TXT 为 `target="_blank"`；未登录请求 Candidate 内容 route 返回 `401`。
- 公开投影/API：`citation_allowed` TXT 只显示静态名称且 button/link 均为 0；`public_preview` Markdown 初始为 `200`，改为 `citation_allowed` 后同 URL 为 `404`；publication 撤销后 PDF 旧 URL 为 `404`。
- Markdown 安全：Candidate、公开问答与 Markdown 来源均保留 heading、list、table、fenced code；raw script 只作为文本出现，三个浏览器哨兵变量均为 `undefined`。
- 布局：桌面 PDF 纸张为 `439.21 × 621.16`、比例 `0.707077`；移动 `430 × 932` 比例同为 `0.707077` 且无横向溢出。portal 后 Markdown 列表项保持正常 list-item 几何。
- 真实浏览器中 Candidate/Admin/Public 受控页面新增 console error/warning 均为 0；fixture、临时 `3100` 进程和隔离上传目录已清理，既有 `askme-local` db/web/worker 保持健康。
- 详细步骤、响应头、几何与截图记录在 [SCN-001 PLAN-012 增量 Evidence](../scenarios/SCN-001.md#plan-012-增量-evidence)。

## Notes

- 本 Plan 不包含部署；当前 Diff 通过隔离 production build 和真实浏览器验收，既有 `3000` Docker Web 仍保持开工前镜像，不报告为已部署。
- 仓库没有 Makefile，因此不存在 `make docs-check` 入口；本次使用项目现有测试、构建、Diff 检查和 `autogo-doc-index` 幂等检查完成对应验证。

## 结论

`PASS_WITH_NOTES`

Notes 不影响目标、安全、验收或恢复。可以进入 `autogo-change-close`，对账 Plan/Progress 并创建原子 Commit。
