# REVIEW-143：PLAN-027 Repository Analysis Runner 最终 Reconcile Change Review

Verdict：`PASS_WITH_NOTES`

- Objective：`OBJ-022`
- Plan：[PLAN-027](../plans/PLAN-027.md)
- Operation：[OP-011](../operations/OP-011.md)
- Bug：[BUG-007](../bugs/BUG-007.md)
- 基线 revision：`0421c17651f6`
- 审查日期：2026-08-17

## Findings

没有阻断发现。`REVIEW-141` 的两项发现已关闭：

- Runner 入口测试现在等待明确 fake `nohup` trace，并断言其参数是当前仓库的 `scripts/agent-runner.sh`；Compose-only 场景继续证明不会调用 `nohup`，临时 state root 不污染真实运行日志。
- Plan 已将删除范围对账为五条 Ferry 重复或诊断失败 Analysis Run，与 `OP-011`、用户“只保留 1 个”的授权和数据库终态一致；Repository、Revision、Artifact、Dossier、账号与 volume 未删除。

## Correctness、兼容与边界

- `scripts/docker-up.sh -d` 只在 Compose 成功且 detached 时请求 `nohup` Runner；`ASKME_SKIP_AGENT_RUNNER=1` 显式保留 Compose-only 行为。项目 PID/lock 只在确认旧 PID 不存活后回收，不安装或修改用户系统服务。
- host wrapper 统一 process/project/user 配置优先级，安全编码 PostgreSQL URL，使用 host Artifact/BoxLite 路径，从 OCI layout 补齐 digest，并删除一次性 GitHub Token。现有 `getRuntimeConfig()` 继续加载项目与用户配置，不建立第二套 AI/Profile 配置源。
- 默认 `globalConcurrency=3` 与现有保留对话槽调度兼容，实际语义是两个仓库并行加一个对话槽；默认 `100/300` 预算和 30 分钟 Repository timeout 已在配置、Compose、`.env.example`、README、Skill、profile fingerprint 与新 run snapshot 中一致。
- Repository source-tool 锁现在同时受轮次和调用次数约束；软门槛要求覆盖目标，硬门槛无条件保留写出预算。工具权限仍只读源码并只允许 `write_wiki` 写隔离输出，Host 的 Citation、Markdown、链接、Dossier 和 cleanup 校验没有被绕过。
- 两个公开仓库最终各只有一条成功 run：Ferry `6 pages / 86 citations / 71 rounds / 150 calls / 66 files`，Goat `4 / 33 / 24 / 57 / 30`；均为 `completed / review_pending` 且 cleanup 完成。最终 readiness 所有检查为 ready/configured，没有残留 BoxLite microVM。

## Verification

- Shell syntax PASS。
- Vitest `107 files / 433 tests` PASS。
- ESLint PASS。
- Next typegen + TypeScript PASS。
- Production Build `31 / 31` PASS。
- Surface Matrix `22 pages / 68 API routes / 76 methods / 29 verification entrypoints` PASS。
- `git diff --check` PASS。
- 当前 API/PostgreSQL 再验证：Ferry 与 Goat 均为 `completed / review_pending`，Dossier 为 `review_pending`，页面/Citation 分别为 `6/86` 与 `4/33`；readiness 顶层与全部 Code Agent 依赖为 ready。

## Notes

- 用户明确排除 UI/E2E，本 Review 不把 Candidate 页面、Console、Network 或响应式行为描述为已验证。
- Codex 自动化命令宿主会回收 detached descendant，因此最终持续运行 Evidence 来自相同入口的持久前台会话；普通 macOS/Linux 终端的正式使用方式仍是 README 中的 `nohup`，进程掉线后按用户要求人工重启，不宣称系统级自动拉起。

## 结论

`PASS_WITH_NOTES`。Notes 已准确记录且不影响目标、安全、验收或恢复；`PLAN-027` 可以进入 Close、索引同步和原子 Commit。
