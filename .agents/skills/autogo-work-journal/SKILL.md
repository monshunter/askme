---
name: autogo-work-journal
description: "为 Fast 与 Standard 交付保存可恢复的短 Journal；在每个原子 Commit 前、进入 Waiting 前或用户明确 Cancelled 前使用；Fast 不要求 Objective、Plan、Review、Session Review 或 Standard delivery trace。"
---
# autogo-work-journal
## 目标
在 Commit 或中断状态生效前，把本次交付的最小恢复上下文追加到 Journal，并保持 Journal 是交付摘要 owner 而不是第二套 Evidence 台账。

## 输入与发现
- 当前路由，以及 Fast 轻量目标或 Standard 的 Objective、正式 Plan
- 当前 Diff、测试与运行 Evidence，以及 Standard 已有的 Review
- 关键决定、未验证项、剩余风险和恢复入口
- Standard 的 autogo-session-review `NO_EVOLUTION` 或 `EVO-*` 结果；Fast 不要求该输入

## 输出与持久制品
- `docs/journal/` 中一条 `delivery`、`handoff` 或 `cancel` 记录
- `路由：Fast | Standard`、范围与 Diff 摘要、关键决定、实际验证、风险、恢复方式和预期 Commit subject
- Standard 的 Objective、Plan 与 `Session Review：NO_EVOLUTION` 或唯一 `EVO-*` 链接；Fast 不写这些专属字段
- 已同步且幂等的 Journal `INDEX.md`

## 副作用与 Human Gate
只修改 Journal 与对应 Index；不创建 Commit、不改写 Review/Operation 原始 Evidence，也不创建或决定 Objective、Plan、Review、Session Review 状态。

## 执行步骤
1. 确认当前路由和记录类型为 `delivery`、`handoff` 或 `cancel`；Fast 读取轻量目标，Standard 从 Progress 锁定当前 Objective 和 Plan
2. 读取当前 Diff 与事实 owner，只摘要已经发生的范围、决定和验证，不复制日志
3. 写入 `记录类型：<type>`、`路由：Fast | Standard`、未验证项/风险、恢复方式和预期 Commit subject
4. Fast 不创建或要求 Objective、Plan、Review、Session Review 或 delivery trace；若 Fast 条件已经失效，先升级 Standard 再记录
5. Standard 写入当前 Objective、Plan 和 autogo-session-review 结果；无可复用 Harness 改进时使用 `Session Review：NO_EVOLUTION`，其他结果链接唯一 `EVO-*`
6. 在 Commit、Waiting 或 Cancelled 状态变更前更新 Journal，并通过 autogo-doc-index 同步 `docs/journal/INDEX.md`
7. 重复执行时更新同一工作单元记录；不重复追加相同 delivery，也不回填 Commit hash 形成第二个 Commit

## 验证与完成
- Journal 声明真实路由，只引用该路由允许的上下文和真实 Diff/Evidence
- Fast 与 Standard 的 `delivery` 都在对应 Commit 前存在，`handoff`/`cancel` 在状态变化前存在
- Fast Journal 不依赖 Standard 专属制品；Standard Session Review 结果为 `NO_EVOLUTION` 或可解析的 `EVO-*` 链接
- 未把 Journal 当作测试、Review、Operation 或 Git 的替代 owner
- Index 与正文一致且重复更新不产生 Diff

## 失败、重试与幂等
Fast 缺少可复核目标、Diff 或验证事实时不创建猜测记录；Standard 缺少当前 Plan 或 Session Review 结果时返回对应 owner。Journal 或 Index 无法安全更新时，两种路由都不得继续 Commit。
- 重复执行前读取当前文件、Git 和运行状态；不重复创建已存在制品或重复执行已生效副作用。
- 相同失败再次出现时停止机械重试，回到 `autogo-investigate` 或上层设计。
- 状态和文档由 Agent 自动维护，不要求用户执行 Harness CRUD 命令。
