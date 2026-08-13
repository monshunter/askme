# REVIEW-063：PLAN-014 Phase 4 隔离 Code Agent Runner 增量 Change Review

## 审查对象

- Objective：`OBJ-009`
- Plan：[PLAN-014 Phase 4](../plans/PLAN-014.md)
- Plan Review：[REVIEW-061](REVIEW-061.md)
- Spec：[SPEC-002 §8、§10、§11、AC-RUN-001 至 AC-RUN-003、AC-COST-001](../specs/SPEC-002.md)
- Design：[DESIGN-005 §7、§8、§10、§11](../architecture/DESIGN-005.md)
- 审查日期：2026-08-13

## Findings

无剩余阻塞 correctness、安全、兼容或范围发现。

审查中发现并已 Reconcile 以下关键问题：

1. Pi session 最初未展开产品 Skill，实际 prompt 只包含 `/skill:<name>`；现已启用 prompt template 展开，并以 guest smoke 证明准确加载单一 Askme Skill。
2. `read` 工具最初可能为超长首行返回无效完整 hash；现已把任何未完整返回的行范围标记为不可引用，并由 Host 拒绝或触发一次有界修正。
3. rootfs 最初只信任配置 digest；现已读取 OCI `index.json` 并核对实际 manifest digest，远端 image ref 也必须显式携带 digest。
4. visibility 从 `private` 提升时可能复用此前已取消的同 Revision run；现已强制创建新 generation，同时保留普通同步幂等与 provenance 漂移不自动重跑语义。
5. Admin 重跑审计最初未携带真实 actor，queue 反馈也可能让已经成功的同步事务表现为整体失败；现已修正 actor 和事务后反馈边界。
6. macOS BoxLite guest 对部分 Linux rlimit 不兼容；现改由 microVM CPU、内存、磁盘、并发、Pi/tool/output budget 与 Host watchdog 共同执行可跨平台的硬边界。

## 正确性与隔离边界

- guest image 固定 Node 24、Pi 依赖精确版本和 npm lock，只安装两个 Askme 产品 Skill；运行时不加载 Repository 内 `AGENTS.md`、Skill、prompt 或默认上下文资源。
- 每个 run 创建新的 BoxLite microVM，Host 先核对不可变 Artifact/manifest，再复制、只读解压并以非 root 用户运行；terminal outcome 前执行确定性 cleanup，启动时清理过期实例。
- guest 只暴露语义化 `ls/find/grep/read`，没有 shell、subprocess、写文件或任意网络工具。网络只允许 AI endpoint；HTTPS 使用 Host secret placeholder，HTTP 兼容路径仅通过当前 microVM 一次性 stdin 注入并显式标记 fallback。
- Host 独立执行 protocol、budget、tool、provenance、Dossier schema 与 Citation 校验；首次输出无效时只允许一次使用剩余预算的修正，不接受 guest 自报的授权或 Citation 事实。
- 数据库 scheduler lock、lease/heartbeat、realtime 优先级、Repository slot 预留、全局并发和四层日配额共同限制执行；pending cancellation、lease 丢失、watchdog 与异常统一进入安全终态。
- 普通同 Revision 同目的请求保持幂等；Candidate/Admin 显式重跑创建下一 generation。同步、visibility 提升、Candidate/Admin 重跑均已连接真实 queue，私有化会请求取消未终态 run。

## Evidence

- `npm run agent-image:build`：PASS，生成 OCI layout，并从 `index.json` 得到 manifest digest `sha256:690cf7b245a2418fa24d9be3902c666cd233f03280d2564750fcaab75e4e75c9`；guest lock audit 为 0 vulnerability。
- `npm run smoke:code-agent-sandbox`：PASS，覆盖真实 BoxLite microVM、Pi tool loop、只读四工具、Repository 指令忽略、无效 Citation 一次修正、microVM 清理、凭证不落盘；当前本机 HTTP fixture 明确记录 `fallback=true`。
- `npm run smoke:repository-analysis-runner`：PASS，覆盖空库 queue → lease → BoxLite/Pi → Host Citation 验证 → microVM 清理 → Dossier 与 terminal run 原子提交。
- `npm run smoke:analysis-scheduler`：空 scratch PostgreSQL 14/14 migration 后 PASS，覆盖隐式 queue 幂等、显式 generation 递增、realtime 优先级、Repository slot 预留、全局并发、日配额与 pending cancellation。
- `npm test`：57 files / 194 tests PASS；`npm run lint -- --quiet`、`npm run typecheck`、`npm run build`、`docker compose config --quiet`、`git diff --check`：PASS。
- production build 产出 24 个 static pages，并包含 Candidate/Admin Repository rerun routes；仅保留既有 Artifact Reader dynamic storage read trace warning，未出现新的 Code Agent 配置 warning。

## 未提前声明的后续范围

- 当前环境没有真实外部 AI key；三份 runner smoke 使用本机 OpenAI-compatible fixture，证明真实 Pi/BoxLite/Host 生命周期和合同，不证明外部模型质量。固定 public Repository 的真实模型 Dossier 与问答基准由 Phase 7 验收。
- `rag/deep/refuse`、Candidate/Public 异步消息、历史 Citation 重投影、SSE、设置与 Admin 运行治理仍由 Phase 5、Phase 6 交付。
- 全部页面、API、正式 Scenario、桌面/移动浏览器与保留数据部署回归仍由 Phase 7 验收；本 Review 不勾选任何 `SPEC-002` 最终 AC。

## 结论

`PASS_WITH_NOTES`

Notes 均由后续未完成 Phase 明确拥有，不影响 Phase 4 的隔离 runner、调度、预算、取消、清理与 queue 接线完成。下一路由：进入 Phase 5.1，统一问答证据、门禁与 `rag/deep/refuse` Router。
