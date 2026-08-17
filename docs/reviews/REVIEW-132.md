# REVIEW-132：host-native Runner launchd 会话服务运行 Reconcile Review

Verdict：`FAIL`

- Objective：`OBJ-022`
- Plan：[PLAN-027](../plans/PLAN-027.md)
- 被否定设计：[REVIEW-131](REVIEW-131.md) 绑定的 `DESIGN-005@87f34579`
- 审查日期：2026-08-17

## Findings

`REVIEW-131` 的会话服务结论被真实 macOS 运行 Evidence 否定，不能进入交付：

- checkout 位于受 TCC 保护的 `Documents` 目录；由 `launchctl bootstrap gui/<uid>` 启动的 job 不继承当前 Codex/终端的目录授权。
- job 被加载并按 `KeepAlive` 重试，但每次都在读取 WorkingDirectory 和 `scripts/agent-runner.sh` 前失败，安全日志为 `Operation not permitted`。
- 运行期间没有产生新 Runner heartbeat，5 个 Repository Analysis run 均未获得 lease，仍为 `pending/pending`；没有 Revision、Artifact、run 或业务数据写入副作用。
- 增加 Full Disk Access 或安装更高权限服务会扩大权限和宿主治理边界，不属于当前授权，也没有必要，因为当前前台终端已经拥有所需目录权限。

## Reconcile

已通过项目入口卸载 checkout-scoped launchd job 并删除其生成 plist，确认 start 命令以 readiness failure 退出。实现回到更小边界：Compose detached 后由同一获授权前台进程 `exec` host Runner；需要 Compose-only 时显式设置 `ASKME_SKIP_AGENT_RUNNER=1`。

## 结论

会话服务方案不得保留或提交；`DESIGN-005`、`PLAN-027` 和实现必须按前台进程所有权重新审查后再继续。
