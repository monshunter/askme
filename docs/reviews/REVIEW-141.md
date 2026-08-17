# REVIEW-141：PLAN-027 Repository Analysis Runner 最终 Change Review

Verdict：`FAIL`

- Objective：`OBJ-022`
- Plan：[PLAN-027](../plans/PLAN-027.md)
- Operation：[OP-011](../operations/OP-011.md)
- Bug：[BUG-007](../bugs/BUG-007.md)
- 基线 revision：`0421c17651f6`
- 审查日期：2026-08-17

## Findings

### P1：Runner 入口测试未证明 `nohup` 实际被调用

`src/server/code-agent/host-runner-entrypoint.test.ts` 为 `nohup` 创建了 fake executable，但成功场景只断言 `docker compose up --build -d` 的 trace 和 stdout 提示，没有断言 trace 中存在 `nohup:<agent-runner.sh>`。实现即使只打印“start requested”而没有调用 `nohup`，测试仍会通过，无法保护本次最核心的完整环境启动合同。

修复：在成功场景断言 fake `nohup` 收到仓库内 `scripts/agent-runner.sh`；继续用隔离 `ASKME_AGENT_RUNNER_STATE_ROOT`，避免测试污染真实日志。

### P2：Plan 数据删除范围与实际恢复操作不一致

`PLAN-027` 范围仍写“仅删除 Ferry 的三条重复失败 Analysis Run”，但恢复过程中又产生两条具有新 Evidence 的失败任务，并在最终成功前按用户“只保留 1 个”的授权删除。`OP-011` 已准确记录共五条，Plan 仍是过期数字，会让最终数据边界对账产生歧义。

修复：Plan 将删除范围改为五条重复或诊断失败 Analysis Run 及级联事件，继续明确 Repository、Revision、Artifact、Dossier、账号和 volume 未删除；更新后重新 Plan Review。

## 已确认事实

- 生命周期、配置默认值、双重预算收敛、OCI digest 和两个公开仓库终态的实现/运行 Evidence 成立。
- Ferry `6 pages / 86 citations / 71 rounds / 150 calls`，Goat `4 / 33 / 24 / 57`；两者均为 `completed / review_pending` 且 cleanup 完成。
- Vitest `107 files / 433 tests`、Lint、Typecheck、Build、Surface Matrix 与 Diff 检查当前通过；UI/E2E 按用户明确要求未运行。

## 结论

返回 Reconcile。修复入口测试与 Plan 删除范围，重跑相关及全量门禁、同步索引后重新 Change Review。
