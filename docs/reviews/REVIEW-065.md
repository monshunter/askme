# REVIEW-065：PLAN-014 Phase 6 异步事件、治理与运行反馈增量 Change Review

## 审查对象

- Objective：`OBJ-009`
- Plan：[PLAN-014 Phase 6](../plans/PLAN-014.md)
- Plan Review：[REVIEW-061](REVIEW-061.md)
- Spec：[SPEC-002 §8、§10、AC-ASYNC-001、AC-COST-001](../specs/SPEC-002.md)
- Design：[DESIGN-005 §3、§7、§10、§11](../architecture/DESIGN-005.md)
- 审查日期：2026-08-13

## Findings

无剩余阻塞 correctness、安全、兼容、运行或范围发现。

审查中发现并已 Reconcile 以下问题：

1. 关闭 Candidate `publicMode` 的初版取消范围包含 Candidate preview；现已收紧为只取消该 owner 的 public conversation analysis，账号停用仍按预期取消 owner 的全部 run。
2. SSE 收到授权失效事件后，消息刷新若仍处于 pending 可能再次建立连接；Candidate 与 Public 客户端现以当前 `errorCode` 共同约束订阅，不重复观察已失效任务。
3. readiness 初版只判断任意 migration 存在；现已固定检查 `0016_analysis_runner_health.sql`，旧 schema 不会被误报为 ready。
4. production build 曾因动态 Artifact 路径扩大文件追踪范围；路径仍先经过 content key、storage path 与 root containment 校验，并对校验后的两个读取点显式关闭 Turbopack 静态追踪，复验后构建零 warning。
5. Repository 公开深度开关初版缺少适合桌面与移动布局的独立 checkbox 样式；现已补齐明确的 label、说明与 disabled 状态布局。

## 正确性、安全与运行边界

- Analysis Run 的数据库 version 是事件事实源；事务内 trigger 只发送 `runId/version` 唤醒，SSE 每次重新读取授权快照，重连先发当前 snapshot，版本单调且终态关闭。
- Candidate SSE 每次校验 owner、run 与 message；Public SSE 每次校验 visitor session、publication、账号、public mode、Repository visibility 与公开深度开关。事件只包含状态、phase、outcome、安全错误码与终态 message id，不包含问题、回答、源码、reasoning、prompt、工具输出或 Secret。
- Repository 降权、关闭公开深度、关闭 public mode、publication pause/revoke、Candidate suspend 与 Admin disable 都在状态事务内请求相关 run 取消并写 version event；物理 Artifact、审计与已批准投影不会因运行取消被破坏性删除。
- Candidate 只能对 `citation_allowed/public_preview` Repository 开启公开深度分析；Host 仍在 queue 与 terminal commit 两次执行 publication、session、visibility、开关与 global/candidate/repository/publication/visitor 配额门禁。
- Admin 页面与 API 只投影 Repository 公共标识、owner 显示名、active SHA、最新 run 状态/phase、安全错误码与数值 usage；不读取或返回源码、用户问题、回答、prompt、tool output、budget 或取消原因。禁用、启用、重跑和取消均有确定性 API 与审计。
- `analysis_runner_heartbeats` 保存 runner 版本、镜像 digest、Artifact/BoxLite 布尔状态、安全错误码与时间，不保存宿主路径。Web 主 readiness 仍由 database、当前 migration 与 worker 决定；Code Agent 缺配置或 runner 不可用时单独报告 `degraded`，不阻止普通文档问答启动。
- runner 在创建 BoxLite runtime 且校验 pinned image/rootfs 后才开始心跳；Artifact root 必须可读写。Admin Settings 显示 Web、worker、runner、Artifact Store、BoxLite、AI、mail 与当日聚合 run usage，不暴露连接串、凭证或内部路径。

## Evidence

- `npm run lint`、`npm run typecheck`、`npm test`：PASS，当前 61 个测试文件 / 208 个测试全部通过，ESLint 零 warning。
- `npm run build`：PASS，24 个页面与全部新增 Admin、Candidate、Public、SSE Route Handler 均完成生产构建；Artifact 动态追踪 warning 修复后构建零 warning。
- `npm run smoke:analysis-sse`：空 scratch PostgreSQL 应用 16 个 migration 后 PASS，覆盖 initial snapshot、事务 NOTIFY 唤醒、version 单调、终态关闭、重连恢复、授权失效与安全 payload。
- `npm run smoke:analysis-scheduler`：PASS，覆盖 realtime 优先级、Repository slot 预留、global 并发、日配额、pending cancellation reconcile。
- `npm run smoke:analysis-governance`：空 scratch PostgreSQL 应用 16 个 migration 后 PASS，覆盖 Admin 安全投影、Repository disable 原子取消、禁用/取消幂等、runner/Artifact/BoxLite 健康与当日 usage 聚合。
- `git diff --check`：PASS。

## 未提前声明的后续范围

- Phase 6 的 scratch PostgreSQL、编译与服务合同已经闭环；真实 Compose 数据库的 0013 migration 会拒绝仍存在的旧 GitHub material。按 `SPEC-002 §1`，是否删除该真实本地数据需要在 Phase 7 部署前单独 Human Gate。
- 当前真实 microVM smoke 使用本机 OpenAI-compatible fixture；固定 public/private Repository 的外部模型事实质量、真实 host runner 心跳、所有页面/API/Scenario、桌面/移动浏览器与保留数据部署仍由 Phase 7 验收。

## 结论

`PASS_WITH_NOTES`

Notes 均由 Phase 7 的真实环境验收明确拥有，不影响 Phase 6 的 SSE、取消传播、公开深度开关、Admin 治理、readiness 与安全观测完成。下一路由：进入 Phase 7.1，先建立当前全站 surface matrix 并完成真实环境部署前只读影响审计。
