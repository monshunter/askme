# REVIEW-140：PLAN-027 Repository Analysis 收敛策略调整 Plan Review

Verdict：`PASS`

- Objective：`OBJ-022`
- Plan：[PLAN-027](../plans/PLAN-027.md)
- 基线 revision：`0421c17651f6`
- Plan SHA-256：`1e3c7b9a8954dc0315803f14bc08ea49cc114c8de2d33bffd43e018ad8f5351d`
- 审查日期：2026-08-17

## Findings

没有阻断发现。

- Ferry 在旧 `50/80` 和新 `100/300` 两组预算下都以 `CODE_AGENT_GUEST_PROMPT_REQUEST_BUDGETROUNDS_FAILED` 终止；新任务的预算快照、Runner 心跳、租约和 BoxLite 清理均正常，排除了配置未生效与基础设施卡死。
- `budget-policy.mjs` 只按工具调用为 Wiki 写出预留预算。默认工具上限升至 300 后，源码工具软/硬锁推迟到 268/280 次调用，而模型先在第 100 轮耗尽；Repository Skill 中仍写着旧的 44 轮、80 次调用合同，形成配置、策略与提示漂移。
- Plan 增加的双重门槛保持用户指定硬边界不变：默认在第 80 轮且达到覆盖目标时锁定源码工具，第 90 轮无条件锁定；工具调用仍在 268/280 次形成软/硬锁。剩余轮次与调用只允许 `write_wiki`，不新增任意 Shell、写仓库或绕过 Citation 验证。
- guest runtime 与 Repository Skill 位于 Code Agent OCI 镜像内，修复后必须重建镜像并用新 digest 创建新 Analysis Run；不得用旧 provenance 重放或中途改写失败任务。

## 结论

`PLAN-027` 可以继续执行 Phase 2.6；先用 budget policy 单测固定 `100 → 80/90` 的轮次门槛，再更新 guest runtime 与 Skill，并在新镜像、新任务上验证 Ferry 收敛。
