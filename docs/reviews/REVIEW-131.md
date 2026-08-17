# REVIEW-131：DESIGN-005 本地 host-native Runner 生命周期 Design Review

Verdict：`PASS`

- Objective：`OBJ-022`
- Plan：[PLAN-027](../plans/PLAN-027.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- 基线 revision：`0421c17651f6`
- Design SHA-256：`87f34579afa17eea2d6997d13f7edf2e47c1851b0615940cd8242810758944b5`
- 审查日期：2026-08-17

## 审查范围

审查 `DESIGN-005` 新增的本地 host-native Runner 生命周期是否满足现有 Repository Analysis/BoxLite 合同，并检查宿主边界、重复启动、配置事实源、Secret、故障恢复、观测、回滚和复杂度。

## Findings

没有阻断发现。

- 方案保留 macOS `Hypervisor.framework` 的真实宿主边界，没有为统一部署表象引入无法使用硬件虚拟化的 Docker Runner。
- 会话服务由当前 checkout 的项目路径隔离，只在当前登录会话存活，不写登录自启目录；相较 LaunchAgent 安装、系统级 daemon 或重构远端 BoxLite API，副作用和实现复杂度更小。
- Compose 与 Runner 的配置优先级只有一个合同；数据库 URL 的构造、一次性 GitHub Token 清除和服务定义不持久化 Secret 覆盖了当前主要配置与泄漏风险。
- 启动必须等待应用 readiness，而不是只信任进程管理器；失败保留 Compose、pending run、Revision、Artifact 和数据，恢复继续使用既有 lease/reconcile 与 cleanup-before-terminal 状态机。
- `status/stop`、当前登录会话退出和重新执行部署入口形成明确、可逆的运维边界，没有新增数据库 schema、产品 API 或权限语义。

## Notes

- 当前实现范围是 macOS 本地环境；Linux KVM 的 user-service 管理不属于本次故障，不应在同一变更中预建抽象。现有前台 `scripts/agent-runner.sh` 仍可作为不支持会话服务环境的显式入口。

## 结论

该设计以最小新增边界修复真实生命周期缺口，可以进入 TDD 与实现。实现必须证明重复 start 不产生第二个 Runner、project `.env` 能覆盖 `~/.env`/默认数据库配置、启动失败不输出 Secret，且当前两个公开仓库 run 能从 pending 收敛到可审核 Wiki 或明确终态。
