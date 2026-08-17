# REVIEW-133：DESIGN-005 前台 host-native Runner 生命周期 Design Review

Verdict：`PASS`

- Objective：`OBJ-022`
- Plan：[PLAN-027](../plans/PLAN-027.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- 基线 revision：`0421c17651f6`
- Design SHA-256：`43c9214979c3fa46b7832fbfaf2c3021af09af4a90532285b8658e286cbb1ea8`
- 审查日期：2026-08-17

## Findings

没有阻断发现。

- 方案保留 macOS `Hypervisor.framework` 与 TCC 的真实宿主边界，由已经拥有项目目录权限的调用进程直接托管 Runner，不新增系统权限、LaunchAgent、daemon 或 PID 状态。
- Compose detached 与 Runner foreground 的所有权明确；终端关闭会让 Runner 停止，但部署命令同时退出，readiness 会诚实降级，不再出现“管理器显示成功但进程无法访问 checkout”的假健康。
- Runner wrapper 统一解析 process、project `.env`、`~/.env` 和本地默认值，安全构造 PostgreSQL URL，并删除一次性 GitHub Token；Compose-only 仍是显式 opt-out。
- crash/restart、pending lease、过期 lease 与 microVM cleanup 继续复用现有状态机，恢复不需要重同步、删 run 或迁移数据。

## 结论

前台生命周期是当前权限边界内最小且可验证的方案，可以进入 TDD、实现和真实 pending run 恢复。
