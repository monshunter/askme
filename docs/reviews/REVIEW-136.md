# REVIEW-136：DESIGN-005 nohup host-native Runner 生命周期 Design Review

Verdict：`PASS_WITH_NOTES`

- Objective：`OBJ-022`
- Plan：[PLAN-027](../plans/PLAN-027.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- 基线 revision：`0421c17651f6`
- Design SHA-256：`4eb467464c10bb76238df7d8ae095eb8c123716d34905d532d6213e07afe1717`
- 审查日期：2026-08-17

## Findings

没有阻断发现。

- `nohup` 直接复用当前 shell 的项目权限与 process env，在 macOS 与 Linux 使用同一项目入口，不再依赖 TCC 不可用的 launchd 或 Linux-specific systemd。
- 项目内 PID/lock 只负责同 checkout 去重和人工恢复，不升级为自动重启服务；进程掉线后 readiness 降级，既有 pending/lease/reconcile 状态保持真实。
- stdout/stderr 只写已忽略的 `data/agent-runner/nohup.log`，Runner 仍不得输出 Secret；一次性 GitHub Token 在 wrapper 进入应用前删除。
- 根 README 明确完整启动、Compose-only、手工恢复、日志和 readiness，避免把 Docker `worker` 与 Code Agent `Runner` 混为一个进程。

## Notes

- `nohup` 不是可靠的系统 supervisor；父执行环境若主动回收 detached descendants，Runner 仍可能退出。用户已明确接受人工重新启动，本次完成条件是入口、去重、可观测和真实仓库恢复成立，不宣称自动拉起或登录后持续运行。

## 结论

该设计可以进入 TDD 与实现；部署验收必须在命令返回后重新检查 Runner heartbeat，而不能只验证 `nohup` 返回成功。
