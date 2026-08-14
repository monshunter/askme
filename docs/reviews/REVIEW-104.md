# REVIEW-104：PLAN-020 Hybrid Agentic RAG V2 Change Review

Verdict：`PASS`

- Objective：`OBJ-015`
- Plan：[PLAN-020](../plans/PLAN-020.md) `sha256:04db5ac58eff4ed1c5dc1e8c1be471d4c0cb2658d1199f572c5d2d0c3cf7bf8b`
- Spec：[SPEC-002](../specs/SPEC-002.md) `sha256:62116947cbf2281ef42e830867a1d247c90e21066b000e299a77e8a8d91dc01c`
- Design：[DESIGN-005](../architecture/DESIGN-005.md) `sha256:730dd47d462d650e4c3633c835c701a5b761769989de88790d4abc648eadf5da`
- Operation：[OP-006](../operations/OP-006.md) `sha256:25524d2bb03af97ace0795a42d3b50874d575fe8cab70337d92761cb604cb343`
- 审查日期：2026-08-14

## 审查范围

审查 Hybrid Agentic RAG V2 的独立 Provider、pgvector migration、版本化索引、Repository Markdown/PDF 与 Approved Wiki 生命周期、Parent–Child chunk、四路召回、RRF/Rerank、Evidence 编排、Claim/Citation 校验、Trace、120 题门禁、Candidate/Public/Admin 集成、强撤销、Code Agent 交界、Docker 部署和目标账号真实浏览器结果。`NOTES.md` 是无关未跟踪文件，不在本次 Diff 或 Commit 范围。

## Findings

没有阻断或需要后续修复的 correctness、安全、兼容、数据或范围发现。

审查过程中发现并已 Reconcile 的问题：

1. DashScope-compatible Rerank 的 path、request/response shape 与 Cohere-compatible 不同；已用显式 protocol 分支和真实 Provider 120 题修复验证。
2. Code Agent 首次 Wiki 输出使用了源码相对链接；Host 正确拒绝，Repository Skill 与 error-specific correction 已禁止未声明 Wiki link，真实 generation 1/3 均在一次 correction 后完成。
3. visibility 恢复会让历史 Citation 重新出现；已在权限降低事务中持久失效受影响消息，并在读取时禁止失效消息重新投影 Citation。真实 private → public_preview 往返证明旧回答不复活、新回答正常使用当前来源。
4. 新 Dossier 批准后旧 projection Wiki source 未 supersede，expected count 和 Repository readiness 漂移；已让 enqueue owner supersede 旧 projection、重算 expected count，并让文档 readiness 只统计 Markdown/PDF。最终 `active=92 / expected=92 / superseded=8`，Repository 为 `ready / 10 indexed / 0 skipped`。

## 正确性、权限与恢复结论

- Embedding、Rerank、Planner、Answer 与 Verifier 配置边界独立；Rerank adapter 按 `dashscope-compatible | cohere-compatible` 选择协议，不静默复用其他 endpoint 或 Secret。
- migration 只新增 `vector`、`pg_trgm` 和派生 RAG 表；重建保留账号、材料、知识项、Repository、权限和会话。active index 固定 1024 维、单版本、过滤后 exact cosine。
- exact、lexical、vector、structured 在 LLM 前约束 owner、account、publication、visibility、active revision/source/index；RRF、family dedup、Rerank、Judge、Verifier 与 Citation validator 均有定向测试和真实运行 Evidence。
- Repository document/Wiki producer 与 Candidate/Public consumer 一致：当前 projection active，旧 projection superseded，固定 commit/path/range/checksum 可从内部阅读页重新授权；旧授权回答不会因 visibility/source 恢复而复活。
- Code Agent 使用只读 immutable Artifact 和独立 BoxLite microVM；Host 校验 Dossier/Citation，Repository 指令不能改变工具或权限。最终 runner/artifact/BoxLite/provenance ready，`pending/running analysis_runs=0`。
- 备份、固定 PostgreSQL/Code Agent image digest、volume 保留重部署、旧 source supersede 和一次性浏览器 session 精确撤销均有恢复或审计路径。

## 当前 Evidence

- 静态与自动化：ESLint 0 warning、Next typegen + TypeScript、production build、`git diff --check` PASS；Vitest `100 files / 348 tests` PASS；npm audit `0 vulnerabilities`。
- 系统门禁：Surface Matrix `22 pages / 68 API routes / 75 methods / 28 verification entrypoints`；Admin Smoke、RAG foundation Smoke、Code Agent sandbox Smoke、Repository analysis runner Smoke PASS，fixture 清理为 0。
- Golden：deterministic 与真实 Provider 各 120 题，整体和全部分段的 Recall@30、Evidence Recall@8、Citation precision、outcome classification 为 `1`，安全指标为 `0`，`failures=[]`。
- Runtime：Web/db/mailpit healthy，worker 和独立 runner running；live=`live`，ready=`ready`，所有 capability checks 为 ready/configured；active index `92/92`，无 queued/processing/failed/revoked source。
- Browser：目标账号富途消息 `588709f2-70bb-4f3e-88fc-b99e135c6591`、最终 Candidate Repository 消息 `8f8d658b-2280-497a-9737-aa69658a4304`、最终 Public 消息 `05049ed5-80e3-4b4c-befa-89ff6437db4d` 均 completed，Trace `rounds=1 / degradations=[]`；Candidate/Public Citation 打开到固定 commit 和精确范围，两个页面 console logs 均为空。

## Notes

- 最终本地数据相对部署前增加一个目标账号 Repository、一个 Public 会话和 14 条真实 E2E 消息；这是保留的验收结果，不是 Smoke 泄漏。一次性目标账号 session 已撤销。
- 本 Review 不把本地验收外推为生产发布、生产容量、扫描 PDF OCR 或已批准延迟项完成。

## 结论

Spec、Design、Plan、实现、测试、真实 Provider、Code Agent、运行环境、目标账号浏览器和 Git 范围一致，未发现新的阻断问题。`PLAN-020 5.4` 可以进入 `autogo-change-close` 对账、关闭与原子提交。
