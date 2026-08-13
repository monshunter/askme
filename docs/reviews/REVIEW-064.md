# REVIEW-064：PLAN-014 Phase 5 问答路由与权限投影增量 Change Review

## 审查对象

- Objective：`OBJ-009`
- Plan：[PLAN-014 Phase 5](../plans/PLAN-014.md)
- Plan Review：[REVIEW-061](REVIEW-061.md)
- Spec：[SPEC-002 §6 至 §8、AC-ROUTE-001 至 AC-ROUTE-003、AC-PRIV-004、AC-HISTORY-001](../specs/SPEC-002.md)
- Design：[DESIGN-005 §5.3、§7、§10、§11](../architecture/DESIGN-005.md)
- 审查日期：2026-08-13

## Findings

无剩余阻塞 correctness、安全、兼容或范围发现。

审查中发现并已 Reconcile 以下问题：

1. 既有两分钟 pending-message recovery 会把仍在排队或运行的深度分析误判为中断；现已排除关联 `pending/running` Analysis Run，失败与取消改由 run terminal transaction 明确结算消息。
2. 初版 RAG persistence 只理解文档 Chunk；现已用统一 Evidence 类型在落库前重新验证文档或 active Approved Dossier 权限，并把 Dossier 的底层源码 Citation 保存到独立 Repository message Citation。
3. Router 之前的 retrieval、settings 或上下文错误可能留下无 run 的 pending placeholder；现已全部纳入失败结算边界，并按实际 Router/RAG model 记录安全错误和 usage。
4. 历史消息查询最初只重投影文档 Citation；现已在每次 GET 重新读取 Repository、Revision 与当前四级 visibility，权限降低时立即隐藏或失效，不依赖创建时快照。
5. 深度结果完成前缺少第二次授权读取；现已在同一事务重新验证账号、publication、public mode、Repository visibility、public deep 开关、conversation、message 和 lease，再原子提交最终消息、Citation、run terminal event 与 safe audit。

## 正确性、隐私与状态边界

- Host 在任何 Router 调用前完成问题 policy、当前 owner/publication、active Approved Projection、Repository visibility、公开深度开关与多层日配额可用性投影；Router 只收到允许的证据摘要和 Repository id 集合，schema 只接受 `rag/deep/refuse`，越权 id 失败关闭。
- 文档 Chunk 与 Approved Dossier claim 通过统一 EvidenceProvider 进入 RAG；源码正文不进入检索索引。Dossier claim 被选中时，最终消息保存其已验证源码 Citation，而不是保存 claim 或 answer 快照作为新知识。
- `conversation_analysis` 幂等键固定为 conversation、`clientMessageId`、Revision 与 route version；高置信 deep 只绑定一个 Repository，低置信先走 RAG，仍无证据且仅有唯一允许 Repository 时才升级。
- Candidate/Public deep queue 均重新验证 active Revision/Projection；Public 额外验证 publication、session expiry、公开 visibility、public-deep 开关以及 publication/visitor 配额。普通 RAG 不创建 microVM。
- 每个 deep run 使用新的 BoxLite microVM 和 `code-question-answering` Skill；Host 重验 output schema、path、line range 与 immutable hash。cleanup 后才在一个事务写 final message、Repository Citation、run outcome/version/event 和 audit；失败或取消不执行 RAG fallback。
- 最终用户问题与消息保存在现有 conversation；Analysis Run 只保存最小 provenance、budget、usage 与状态。reasoning、tool output、源码正文、prompt 和 Secret 不进入消息、event、audit 或日志，深度结论不写 Dossier、Knowledge Item 或其他检索事实。
- Candidate 可打开当前非 private Repository 的历史精确 Citation；公共 `citation_allowed` 只投影 Repository 名称，`public_preview` 才生成绑定 visitor session、message、Revision、path 与 200-line 上限的 `no-store/nosniff` 源码视图。

## Evidence

- Red/Green：新增 Router Host candidate/gate/invalid-output 测试、统一 EvidenceProvider 聚合/visibility 测试、Code Answer immutable Citation 测试与 Repository 公共重投影测试；`npm test` 当前 60 files / 205 tests PASS。
- `npm run smoke:repository-analysis-runner`：真实连续创建两个 BoxLite microVM，并通过 Pi 完成 Repository Dossier 和 Conversation Deep Analysis；验证 queue 幂等、question 恢复、Host Citation、cleanup-before-commit、final message、Repository message Citation、immutable source preview，以及 deep conclusion 未写入 Dossier。
- `npm run smoke:analysis-scheduler`：空 scratch PostgreSQL 14/14 migration 后 PASS，继续覆盖 realtime 优先级、Repository slot 预留、全局并发、日配额和 pending cancellation；conversation failure/cancellation 同步结算 assistant message。
- `npm run lint -- --quiet`、`npm run typecheck`、`npm test`、`npm run build`、`git diff --check`：PASS；production build 包含 Candidate/Public source routes 与 chat routes，共 24 个 static pages。
- production build 仅保留既有 Artifact Reader dynamic storage read trace warning，没有新增编译、类型或路由 warning。

## 未提前声明的后续范围

- 浏览器尚未通过 SSE 自动观察异步 run；snapshot/version、NOTIFY、重连、invalidated close、终态重取与 Candidate/Public 失败重试 UI 由 Phase 6.1 交付。
- Candidate public-deep 设置、Admin cancel/health/usage 与 runner/readiness 由 Phase 6.2 至 6.4 交付。
- 当前真实 microVM smoke 使用本机 OpenAI-compatible fixture；固定 public/private Repository 的外部模型事实质量、所有页面/API/Scenario、桌面/移动浏览器和保留数据部署仍由 Phase 7 验收。

## 结论

`PASS_WITH_NOTES`

Notes 均由后续未完成 Phase 明确拥有，不影响 Phase 5 的问答路由、异步 deep run、消息历史、权限重投影与不可变源码预览完成。下一路由：进入 Phase 6.1，交付基于数据库 snapshot/version 的授权 SSE。
