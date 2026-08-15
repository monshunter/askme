# REVIEW-129：PLAN-026 Query-understood RAG 最终 Change Review

Verdict：`PASS_WITH_NOTES`

- Objective：`OBJ-021`
- Plan：[PLAN-026](../plans/PLAN-026.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- Operation：[OP-010](../operations/OP-010.md)
- Bug Report：[BUG-006](../bugs/BUG-006.md)
- 审查分支：`feat/mature-rag-system`
- 审查日期：2026-08-15
- 审查基线：`HEAD 2cd1d3f`
- 实现与部署事实 Tracked Diff（本 Review 与关闭状态写入前）：`sha256:60f3539dbe93c6d018f880a0defbaabe00e9df24695dc0e7b7f16546ae20107e`
- 新增项目文件清单（本 Review 写入前）：`sha256:43b6a0687ea0bf843859bf0e752ab4cd8d8dda525f27a205584e68b2ae4c06a5`

## 审查范围

以部署后代码、真实数据、持久 Trace 和最终评测为当前事实，审查 Query Understanding Agent、Host validator、条件 Adjudication、Required/Context role、Entity Catalog/Scope、四路 Hybrid Retrieval、时间过滤、Answerability、Claim/Citation、Candidate/Public consumer、Deep gate、Trace、配置、评测入口、Knowledge 重组、Compose 部署与浏览器验收。`RAG_BUGS.md`、`RAG_NOTES.md` 和三张输入图片是用户提供的未跟踪参考输入，不属于待提交项目 Diff。

## Findings

没有阻断 Objective 完成的 correctness、权限、数据、安全、兼容、恢复或范围发现。

部署前 Review 后发现并已 Reconcile 的问题：

1. 最终 Answerability 可能从 provisional candidates 中移除 Evidence，但 Trace 的 token 与 independent-family 指标仍使用移除前结果。当前只从最终 selected Evidence 重算指标，并由 service test 固化。
2. 时间约束外 Evidence 虽不会被 Answerability 选中，仍曾进入其输入。当前在 Answerability 前明确移除 `temporal=outside`，保留完整 annotation 供 Trace，并用跨区间测试证明不返回越界 Evidence。
3. Context Packet 达到 6000 字符时曾保留最旧消息，英文问句过滤还会把 `Showcase` 因包含 `how` 子串误删，纯 `YYYY-MM - YYYY-MM` 也未识别。当前优先保留最近消息、使用 question-word 边界并兼容普通连字符，均有回归测试。
4. Provider 的 `desiredEvidenceTypes` 曾可能把 Host 必需的 source kind 窄化掉。当前只允许在 Host 基础类型上做受控并集，四路 SQL 仍在同一 owner/visibility/active/scope CTE 内过滤。
5. “看过 Askme 后，我还做过哪些项目？”在召回充足时仍出现过间歇性整体拒答。Answerability Packet 现在携带 mention role，并明确 `context` 不构成 subject/scope/coverage 要求；R023 连续 `5 / 5 PASS`，最终 Runtime 矩阵再次通过。
6. “Askme 和 MoonBase 分别解决了什么问题？”曾在 Askme 已解析、MoonBase 缺失时把共享 aspect 整体判为 unsupported。Packet 现在结构化区分 `requiredResolution.resolved` 与 `requiredResolution.unavailable`，后者由 Host 作为 partial gap 呈现；R015 连续 `5 / 5 PASS`，最终 Runtime 与 HTTP 全量复验通过。

## 合同、权限与恢复结论

- 无显式实体的经历、项目、技能、教育与时间问题以 `profile_owner/discovery` 检索当前 owner 的授权知识；只有答案必须归属于明确实体时才建立 required scope。代词只消费同一会话持久 Trace 的唯一可信 focus。
- Query Agent 与最多一次 Adjudicator 可以解释意图、主体、范围、字段和上下文，但 Host 重新校验 enum、长度、来源、Catalog、可信 focus、allowed evidence types、权限与 hard-stop；模型不能扩大 tenant、visibility、Citation 或 Deep 权限。
- 显式未知/歧义实体、无可信指代和 query clarification 在检索或 Deep 路由前 fail closed；已解析与缺失实体并存时只回答已解析部分并明确缺口，不用相似实体替代。
- 时间区间只在请求态从 Evidence 解析并以 inclusive overlap 过滤，不回写业务事实。Answerability 只把直接支持对应 aspect 的 Evidence 交给 Generator，Claim Verifier 与 Citation Validator 继续独立执行。
- 本次重组只更新派生 Knowledge；RAG fingerprint 未变时复用完整 active index。维护前 custom dump 可由 `pg_restore -l` 读取，账号、原始 Material、Repository、Publication、权限和原会话没有被删除。

## 当前 Evidence

- 单元与静态：Vitest `105 files / 423 tests`、ESLint、Next typegen + TypeScript、production Build `31 / 31`、Surface Matrix `22 pages / 68 API routes / 76 methods / 29 verification entrypoints`、`git diff --check` 全部 PASS。
- Query Understanding：真实 Query Agent `20 / 20 PASS`；`requiredRoleFalsePositive=0`、`requiredEntityMiss=0`、`discoveryFalseNone=0`、`entitySubstitution=0`。
- Core：120 个 synthetic retrieval 的 `initialRecall@30=1 / rerankRecall@8=1 / permission refusal rate=1`，visibility 与 forbidden selection leak 为 0；12 个 entity-grounding、10 个 entity-query 全部 PASS。该入口不声称真实 SQL、Provider outcome 或 Citation precision。
- Runtime：最终镜像在 Compose 网络内以真实 PostgreSQL、Planner、Embedding、Rerank、Answerability、Generator、Verifier 和 Citation Validator 完成 `26 / 26 PASS`，其中 24 个行为场景、2 个故障降级场景，`failures=[]`。
- HTTP：最终镜像完成 `16 / 16 PASS`；Candidate 7、Public 6、Public Profile 3，未知实体新增 Deep Run 为 0，Public 不泄露内部 Citation ID，incidental entity 不成为 required，focused entity 保持 required。
- 浏览器：Candidate Preview 与公开 Agent 已验证 grounded/failed-close、Citation、跨 Candidate 隔离、会话刷新持久化、Console 无 error/warning；公开页 `390×844` 无横向溢出。最终 Answerability 修订不改变 UI，其用户行为已由最终镜像 HTTP 全量复验覆盖。
- 环境与数据：Ready 顶层为 `ready`，database/migration/worker ready、AI configured；web healthy、worker running、migrate exit 0。最终为 `61 conversations / 364 messages / 37 knowledge items / 92 active sources / 417 active children / 1 active index / 0 active RAG source leases`。

## Notes

- 当前浏览器 Evidence 来自 Codex in-app browser；外部 Chrome 控制连接不可用，不将其描述为外部 Chrome 验收。
- Ready 中 Code Agent 的 runner stale、artifact degraded、BoxLite unavailable 与 provenance unverified 是独立既有状态；本 Plan 证明 RAG/Query Understanding/Citation/Public Chat，不证明 Code Agent 已恢复。
- 当前样本、真实 Provider 与本机 Compose 证明既定类别和边界可用，不外推为生产容量或开放语言数学零错误；新增分布仍应进入相同 Query/Runtime/API 门禁。

## 结论

`PASS_WITH_NOTES`。Notes 不影响目标、安全、验收或恢复；PLAN-026 Phase 6.1 可以关闭，并进入正式制品同步、Objective 对账与原子 Commit。
