# REVIEW-047：PLAN-011 Change Review

## 审查对象

- Objective：`OBJ-006`
- Plan：[PLAN-011](../plans/PLAN-011.md)
- Spec：[SPEC-001](../specs/SPEC-001.md)
- Scenario：[SCN-001](../scenarios/SCN-001.md)
- Revision：`HEAD 2800607 + opt/agent-publication-sharing working tree`
- 审查日期：2026-08-12

## 正确性与兼容边界

- 隐私确认投影明确区分首次未确认、当前 revision 已确认和旧 confirmation 因 revision 变化而失效；页面只在未确认时渲染操作，失效状态使用“再次确认”，已确认状态不再暴露冗余按钮。
- 可见性 PATCH 在同一事务内重新读取真实 policy row，响应与后续 overview 对 `requiresReconfirmation` 的判断一致，不再由客户端 refresh 修正短暂错误状态。
- Candidate Agent 链接模块、链接预生成/复制/下载实现、专用样式和双语文案已删除；`POST /api/publications/link` route 与唯一 `generatePublicationLink` producer 同步删除，活跃源码无残留 consumer。
- `publishAgent` 既有事务继续在无 publication 时直接生成 opaque slug；历史 `draft` 仍原地转为 `published`，因此 API 退役不要求 migration，也不破坏已有 draft 数据。
- 发布后的 `shareUrl` 继续由 current/publish API 作为“访问Agent”href 使用；访问操作在 DOM 与桌面几何上均位于“撤销访问”之前，revoke 与 Public Mode 语义保持不变。
- 公开页分享使用 `navigator.clipboard.writeText(window.location.href)`，成功和拒绝均有可见反馈；Blob、object URL、download filename 与旧下载文案已全部移除。
- Diff 不修改数据库 schema、migration、公开检索权限、Platform Admin 治理、Secret、外部依赖、现有 Docker 服务或 volume。

## 当前 Evidence

- TDD Red：privacy 三态测试因缺少 `requiresReconfirmation` 失败；Candidate 合同测试因链接 route/module 仍存在且缺少访问操作失败；Public 合同测试因仍创建 Blob 下载且未写 clipboard 失败。
- Green 与回归：`npm test` 通过，`44 files / 148 tests`；`npm run typecheck`、`npm run lint`、`npm run build` 与 `git diff --check` 通过。production route 表包含 publication current/publish/revoke，不包含 publication link API。
- 当前 production build 在隔离 `3100` 端口运行时 `live=200`，ready 报告 database、migration、worker 为 `ready`、AI 为 `configured`；验证后进程已停止，现有 `3000` Docker 服务保持运行。
- Privacy smoke：`reconfirmationVisibleOnlyAfterChange=true`，同时覆盖 API 三态与 SSR 中确认后隐藏、revision 变化后显示、再次确认后再隐藏。
- Publication smoke：`retiredLinkApiUnavailable=true`、`directPublish=true`、`legacyDraftCompatible=true`、`republishedWithNewSlug=true`；撤销、旧 slug 不可用、公开投影隔离和 audit count 同时通过。
- 真实浏览器：确认后“再次确认”按钮数量为 0，可见性变化后为可见；发布页不存在链接模块；“访问Agent”矩形 `right=1083.99` 小于“撤销访问”矩形 `left=1091.99`；公开页 clipboard 哨兵被精确覆盖为当前 URL；移动公开页 `scrollWidth=clientWidth=430`；撤销后旧 URL 显示不可用；Candidate/Public console error/warning 均为 0。
- Fixture Candidate、隔离浏览器 tabs 与临时 `3100` 进程均已清理；没有 reset 本地数据库或删除其他用户数据。

## Notes

- Codex in-app Browser 没有为 `target="_blank"` 点击暴露新 tab 事件。本次已验证“访问Agent”的真实 href、目标公开页可访问和按钮几何，但不把自动打开新标签描述为已观察；这不影响用户要求的访问入口与目标页面可用性。
- 本 Plan 不包含部署，现有 `3000` Docker Web 仍是开工前镜像；当前 Diff 只通过隔离 production build 验收，未报告为已部署。

## 结论

`PASS_WITH_NOTES`

Notes 不影响目标、安全、验收或恢复。可以进入 `autogo-change-close`，对账 Plan/Progress 并创建原子 Commit。
