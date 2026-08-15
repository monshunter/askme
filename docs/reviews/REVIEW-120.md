# REVIEW-120：PLAN-025 成熟 Entity-grounded RAG 部署前 Change Review

Verdict：`PASS_WITH_NOTES`

- Objective：`OBJ-020`
- Plan：[PLAN-025](../plans/PLAN-025.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- 审查分支：`feat/mature-rag-system`
- 审查日期：2026-08-15

## 审查范围

审查 `knowledge_items.entities` migration、Knowledge Organizer 证据绑定、授权 Entity Catalog、Planner 实体保真、检索前 hard scope、四路 SQL、Answerability Gate、Coverage/冲突语义、Candidate/Public consumer、Deep Repository 边界、Trace、可重建索引和离线/运行时评测入口。本次结论只允许进入本地保留数据部署；知识重建、真实 Provider 评测、API、浏览器和部署后数据对账仍是待完成门禁。

## Findings

没有阻断部署的 correctness、安全、权限、数据或范围发现。

实施和审查过程中发现并已 Reconcile 的问题：

1. 旧 `conflictDetected` 只要宽泛词跨两个 evidence family 且任意正文含否定词就返回 `conflicted`，与同一实体/方面/可比较事实无关。该启发式已删除，冲突只由一次结构化 Answerability Gate 提出，并由 Host 校验至少两个独立 evidence family。
2. 初版中文语法提取会把“这个项目”“候选人有哪些项目”中的指代词、角色词或类别词当成 strict identity，导致通用问题被 hard scope。现在 deterministic/provider mentions 共用 generic identity 过滤，显式专名与上下文指代分别保留。
3. 初版 Deep fallback 仍可能使用 Router 选择的 Repository。两个 consumer 现在只接受 Entity Resolver 唯一解析出的 Repository ID；Router 不能扩大或替换 identity scope。
4. 旧 120 题脚本通过题目关键词和 case tag 直接合成 coverage/outcome。该结果不再作为召回、幻觉或 outcome Evidence；离线入口明确只执行数据合同、Query Analyzer、visibility policy 和 Entity Resolver，真实结果由独立 PostgreSQL/Provider 入口验证。

## 正确性、安全与恢复结论

- Material entity 必须由 Item 选中的 Evidence 或来源标题支持；canonical/alias 经过 NFKC 与稳定分隔符归一，未授权或不合法 JSON 不进入持久化。
- Catalog 对每个 request 按 owner、caller visibility、Material/Repository 当前状态重新投影；ambiguous alias 不猜测，未知 strict entity 在 Embedding 前结束。
- 四路检索共用带 Entity Scope 的 `eligible` CTE；scope 为非空时，Material 和 Repository evidence 都不能越过解析集合。
- `Source + Entities + Section` 只进入 contextual retrieval text；原文、Parent 与 Citation 不被改写。prefix 版本改为 `source-entity-context-v2`，不会与旧向量混用。
- `rag:rebuild` 默认 dry-run，只有 `--execute` 才重组 Knowledge/构建新 index，只有同时 `--activate` 才原子切换；账号、原始 Material/Artifact、Repository、权限、Publication 与会话不在清理范围。
- Answerability Provider 失败为 `AI_ANSWERABILITY_FAILED`，不会降级发布未判定 Evidence；Generator 只收到 Gate 选中的 Evidence，Claim Verifier 与 Citation validator 继续独立执行。

## 当前 Evidence

- TDD 与全量回归：Vitest `104 files / 382 tests` PASS，新增组织实体、Catalog、Planner、hard scope、冲突、Answerability、Deep 与 Trace 定向测试。
- 静态门禁：ESLint、Next typegen + TypeScript、production Build `31 / 31`、`git diff --check` PASS。
- 离线核心评测：旧 120 题只完成 schema/reference/Query Analyzer/visibility 合同验证；12 个实体解析/未知/别名/歧义/soft/multi-entity case 全部 PASS；输出显式声明 `no_database_retrieval / no_provider_calls / no_answer_outcome_claim`。
- 部署前数据基线：`4 users / 4 indexed materials / 39 knowledge items / 3 repositories / 1 active index / 92 active sources / 428 active children`；Compose db/web/mailpit healthy、worker running。

## Notes

- 真实 migration、Knowledge 全量重组、新索引激活、运行时 12 题、Candidate/Public API 和浏览器 E2E 尚未执行，因此本 Review 不关闭 `PLAN-025 4.3 / Phase 5 / Phase 6`，也不声明 Objective 已完成。
- Code Agent runner 的既有 degraded 状态不在普通 RAG 改造范围；Deep 边界需要在本轮场景中证明不会被未知或错误实体触发，但不把 runner 恢复作为成熟 RAG 的完成条件。

## 结论

当前 Diff 与 Spec/Design 一致，可进入本地保留数据部署和全量派生知识重建。部署或真实 E2E 出现失败时必须返回对应实现 owner 修复并重新 Review；只有部署后 Review 通过才可关闭 Plan。
