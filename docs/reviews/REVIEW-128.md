# REVIEW-128：PLAN-026 Query-understood RAG 部署前 Change Review

Verdict：`PASS_WITH_NOTES`

- Objective：`OBJ-021`
- Plan：[PLAN-026](../plans/PLAN-026.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- 审查分支：`feat/mature-rag-system`
- 审查日期：2026-08-15
- 审查代码 Diff：`sha256:368bc9c08cf73b9a08c91b833eaf9b5ac52b39c53c00fafbea6ee5a48df8f7fb`

## 审查范围

审查 Query Semantics schema、Deterministic seed、受控 Context Packet、初次 Query Understanding Agent、条件二次 Adjudication、Host validator、Required/Context role、Entity Resolution、Evidence type/source filter、time range、Answerability、Candidate/Public consumer、Deep Host gate、Retrieval Trace、评测入口、配置与文档。当前结论只允许进入本地保留业务数据的 Knowledge/RAG 重建和部署；真实 PostgreSQL runtime、HTTP API、浏览器与部署后数据对账仍是待完成门禁。

## Findings

没有阻断部署的 correctness、安全、权限、数据或范围发现。

实施与本次审查中发现并已 Reconcile 的问题：

1. 初版仍允许模型把 `你在哪家` 作为 required organization。Host 现在拒绝代词、疑问词和不完整问句实体，`company/job_title/responsibilities` 作为 requested fields；生产服务测试证明该问题在 round 1 进入无 Entity Scope 检索。
2. 初版 Catalog Alias 出现即 hard scope，会把 incidental mention 错当目标。当前 Query Agent 结合问题与受控上下文输出 role，Host 只对明确 target grammar 提供高置信 seed；“看过 Askme 后还做过哪些项目”保持 discovery/context。
3. Provider 实测会返回 `core_functions`、日粒度日期、额外 semantic query 或 `source=conversation` 等近义结构。Validator 只对白名单字段、枚举别名、长度和数量做有界归一后重新通过 strict schema；残缺对象、越权 evidence type 和未受信会话实体仍 fallback 或被拒绝。
4. 只依赖当前 Query Agent 一次输出无法纠正将要发生的 hard-stop。Orchestrator 现在仅在 hard-stop、低置信、真实歧义或模式冲突时执行一次 Adjudication；`adjudication.applied` 阻止循环，失败保留初始安全计划。
5. V3 `desiredEvidenceTypes` 只进入 Trace。四路 SQL 现在在同一授权 CTE 中实际执行 source-kind filter，仍先应用 owner、visibility、active revision 和 Entity Scope。
6. 时间范围初版只扩展检索词。当前请求态从 Parent Evidence 解析有限年月区间，使用 inclusive overlap，把明确 outside Evidence 排除在 Answerability 前，unknown 仍由 Evidence Gate 读取原文；不写回业务事实。
7. Provider 返回 discovery 时曾覆盖无可信 Trace 的“它”。Host 现在只接受当前会话上一轮安全 Trace 的唯一 focus；原始会话文本不能建立实体，未解析指代保持 clarify 并以 `query_clarification_required` 结束。

## 正确性、安全与恢复结论

- 当前问题、最近 6 条受控消息、当前问题内 Catalog candidates、唯一可信 Trace focus、deterministic seed 和 allowed evidence types 是 Query Agent 的全部上下文；不暴露 Catalog 全量、Evidence、向量、Secret 或跨 owner/visitor 数据。
- Entity Resolver 只消费 required role；context mention 仅保留检索语义和安全诊断。显式未知实体在检索前结束，discovery 不因 Catalog 缺失或待求字段结束。
- Query Understanding、Entity Resolution、Retrieval、Answerability、Claim Verifier 与 Citation Validator 保持分离；模型不能扩大权限、替换实体或直接发布 Claim。
- Clarification 复用既有 `insufficient_evidence` outcome 和专用文案，不新增数据库/API 状态；Host entity/query gate 会跳过 Router 与 Deep。
- V4 不要求 schema migration；重建只替换派生 Knowledge/RAG index，旧 active index 在新 index 激活前可恢复，账号、Material、Repository、Publication、权限与会话不在清理范围。

## 当前 Evidence

- TDD 与回归：Vitest `105 files / 416 tests` PASS；新增无实体/显式实体、自我主体、incidental entity、时间 overlap、source-kind filter、clarification、Trace 与单次 adjudication 覆盖。
- 静态门禁：ESLint、Next typegen + TypeScript、production Build `31 / 31`、Surface Matrix 与 `git diff --check` PASS。
- 离线核心：120 retrieval、12 entity-grounding、10 entity-query 全部 PASS，权限与 forbidden evidence 泄露为 0；该入口仍明确声明不证明数据库 SQL、Provider outcome 或 Citation precision。
- 真实 Query Agent：20/20 成对语义 case PASS；required-role false positive、required entity miss、discovery false-none、entity substitution 均为 0。

## Notes

- 当前 Review 尚未执行新镜像部署、Knowledge/RAG 全量重建、真实 PostgreSQL 24-case、Candidate/Public HTTP 与浏览器 E2E，因此不关闭 PLAN-026 Phase 4.2、Phase 5 或 Phase 6。
- 当前本地数据规模和既有 Code Agent degraded 状态不用于证明生产容量或 Deep 可用性；本 Plan 只要求未知/歧义 RAG 请求不错误触发 Deep。

## 结论

`PASS_WITH_NOTES`。Notes 不阻断本地保留业务数据部署；若重建、真实 Provider runtime、HTTP 或浏览器验收失败，返回对应实现 owner 修复并重新 Change Review。
