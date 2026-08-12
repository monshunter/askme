# REVIEW-042：PLAN-009 专用预览后端 Reconcile 后 Change Review

## 审查对象

- 制品：`PLAN-009` 最终 Diff、`SPEC-001`、`DESIGN-001`、`SCN-001` 与专用 Candidate 公共预览后端 Reconcile
- Revision：`HEAD 7ce39ec + PLAN-009 final working tree`
- 上层 Objective：`OBJ-004`
- 前序审查：[REVIEW-041](REVIEW-041.md)
- 审查日期：2026-08-12

## Reconcile 正确性

- 删除的 `GET /api/publications/preview` 只调用 `loadCandidatePublicPreview`，该 service function 也没有其他消费者；两者属于已退役 `/workspace/publish/preview` 页面专用后端。
- publication current/link/publish/revoke API、public Agent API、readiness/publish/revoke service 与数据库模型继续由 Agent 页面或公开访问链路使用，未因清理专用预览后端而扩大删除范围。
- publication smoke 不再通过已删除的 Candidate API 比较投影，改为直接断言匿名公开投影包含 `public_preview` 证据且不包含 `agent_only`/`private` 内容；安全边界仍被当前运行 Evidence 覆盖。
- Candidate workspace 合同测试明确要求旧页面和专用 preview API 的 route 文件均不存在；production build 路由表不包含 `/api/publications/preview`。

## 最终范围与兼容

- Candidate 只有 Agent / 智能体入口，发布生命周期位于同一页面；Quick Action、Invite Interviewers、Publish Agent 导航和专用页面/后端已移除。
- Root Layout 仍是唯一语言切换 owner；Askme / 职问品牌与英文 Agent / 中文智能体命名保持不变。
- Reconcile 不修改数据库、持久数据语义、公开权限、locale API/cookie、Platform Admin 治理、Secret 或运行环境；删除对象无产品消费者，回滚不需要数据恢复。
- `REVIEW-038` 最终 Spec/Design decision matrix 仍与完整 Diff 一致。

## 验证

- 完整 Vitest：43 个文件、143 个测试通过；`npm run typecheck`、`npm run lint`、`npm run build` 与 `git diff --check` 通过。
- production build 路由表只包含 publication current/link/publish/revoke 和 public Agent API，不包含专用 `/api/publications/preview` 或旧 workspace publish 页面。
- 当前 revision 以 `next start -p 3100` 运行，live/ready 均为 200；ready 报告 database、migration、worker、AI 为 `ready/configured`。
- publication smoke 重新通过，包含 `publicProjectionSafe=true`、`agentPublicationRendered=true`、`retiredPublishPagesUnavailable=true`、`singleGlobalLanguageSwitcher=true`、`revoked=true`；旧页面和专用 preview API 均为 404。
- bundled delivery trace 回归通过；`PLAN-009` strict trace 为 `0 errors, 0 warnings`。

## 发现

最终 Diff 未发现会影响目标、正确性、兼容、安全、可访问性、恢复或范围的缺陷。

## 结论

`PASS_WITH_NOTES`

`PLAN-009` 的产品、专用后端清理、合同、自动化与运行 Evidence 均成立，可以继续最终 Journal/trace/Git 对账与原子提交。

Note：Docker 镜像重建仍未完成，边界与 `REVIEW-041` 一致；宿主机 production build、当前 revision production server 健康检查和真实 publication smoke 已重新通过。本 Plan 不包含部署或镜像发布，该 note 不影响目标、安全、验收或恢复。
