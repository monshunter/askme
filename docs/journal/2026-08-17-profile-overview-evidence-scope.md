# 2026-08-17：自我介绍类问题被仓库文档污染（答成产品介绍）与 gate 慢响应修复

记录类型：delivery

路由：Fast

## 目标与范围

修复 Candidate/Public Agent 回复「你好，麻烦你做一个简单的自我介绍」时把候选人的产品仓库文档（`monshunter/askme · SPEC.md`）当作证据，答成「Askme 是个人职业知识库 Agent…」的内容错误；同时修复该场景下 ~68s 的 gate 调用延迟（30s 超时 + 重试成功 ≈ 68s）。

本次变更涉及 `rag-query-service.ts`（证据范围收窄）、`answerability-gate.ts`（profile_owner 证据主体约束）、`config.ts`（verifier 单次长超时禁重试）及对应测试；不涉及索引 schema、数据库、UI 或生产环境。

## 根因

- **内容错**：`overview_fallback` 只在 answerability gate 返回 `none` 时兜底。实际 trace（`rag_query_traces` 11:36:45，`322f94f0`）显示：planner 规划 `career_summary/profile_owner`、`desiredEvidenceTypes` 含 `repository_document`；SPEC.md 全篇 20 处「候选人」、含「介绍一下这个候选人的 AI Agent 经验」示例句，vector/lexical/exact 三路命中且 rerank 0.45–0.67 压过材料（0.36），证据包被 SPEC.md 占满；实体解析为空（`gateReason=no_required_entity`，无任何必需主体约束），gate LLM 判 `full` → fallback 被完全绕行 → 回答生成拿产品文档答候选人。
- **慢**：检索阶段唯一慢的 LLM 调用是 gate（verifier profile 30s timeout + maxRetries=1），DeepSeek 偶发慢响应被「超时+重试」放大成 ~68s（`ai_usage.public.chat` 记录的是整个请求耗时，好回答总耗时 8s vs 坏回答 71s，差异几乎全部在检索阶段）。

## 本次实际完成

- `src/server/rag/rag-query-service.ts`：新增 `profileOverviewEvidenceScope(plan)`——对 `isProfileOverviewPlan`（career_summary，或 general_career+profile_owner，且无必需实体）的计划，在首次 `runBoundedRetrieval` **之前**把 `desiredEvidenceTypes` 收窄为 `material/knowledge`（排除 repository_document/approved_wiki），并打 `profile_evidence_scope` 标记（trace 可观测）。产品文档不再进入候选集；`overview_fallback` 保留为 gate 仍判 none 时的二次机会。带必需实体的查询（如「我在富途控股的经历」）不受影响，仓库文档仍可用。
- `src/server/rag/answerability-gate.ts`：新增 `profileOwnerEvidence` 输入；为真时系统提示追加「证据必须直接描述候选人本人的经历/技能/项目，描述候选人作品的产品/仓库/wiki 文档不算支持证据」。`rag-query-service` 的两处 `runGate` 均以 `isProfileOverviewPlan(plan)` 传入。
- `src/server/config.ts`：`profile()` 增加 `defaultMaxRetries` 参数；verifier 改为 `timeoutMs=90_000, maxRetries=0`——单次长尝试替代「30s 超时 + 重试」，消除超时+重试成功的 2 倍耗时叠加。
- 测试：`rag-query-service.test.ts` +3（career_summary 收窄且全部路由只查 material kind、general_career+profile_owner 收窄、带必需实体不收窄）；`answerability-gate.test.ts` +2（profileOwnerEvidence 约束进提示、非 profile 问题不加）；`config.test.ts` +2（verifier 90s/0 与其他 profile 保持重试、env 覆盖仍生效）。全量 Vitest `108 files / 456 tests`、ESLint、tsc 全绿。

## 验证

- 单测覆盖三类路径：概述类问题收窄并打标、必需实体问题保留仓库文档、gate 提示含主体约束。
- 修复后真实 API 实测 3 次（`scripts/docker-up.sh -d` 重建容器后，public agent `C3zvY0BaYzfGSLaWXKjRINx6bR8hk1y3`）：「你好，麻烦你做一个简单的自我介绍」×2、「介绍一下你自己」×1，回答均为候选人本人职业介绍（欢聚时代/探迹→富途→圆币科技），1–3 条 Citation 全部 `material · 小马田-职业profile.md`；Trace `coverage=full / roundCount=2 / degradations=[profile_evidence_scope] / desiredEvidenceTypes=[material,knowledge] / 检索阶段 4.1–5.1s`，总耗时 10–19s。
- 修复前对照（11:36:45，`322f94f0`）：desiredEvidenceTypes 含 repository_document、degradations=[]（fallback 被绕过）、证据为 SPEC.md、检索阶段 67.8s、总耗时 ~71s。

## 恢复方式

- 代码层可直接回退本次 Commit；行为变更点为 `rag-query-service.ts` 的 `profileOverviewEvidenceScope`、`answerability-gate.ts` 的提示追加、`config.ts` 的 verifier 默认值三处。
- 若再次出现「自我介绍答成产品介绍」：先查 `rag_query_traces` 该问题行的 `desiredEvidenceTypes`（应只剩 material/knowledge）与 `degradations`（应含 `profile_evidence_scope`）；若含 `repository_document` 说明收窄未生效（计划被合并逻辑改写），若含 `overview_fallback` 说明 gate 仍判 none 走了兜底。
- 若再次出现 gate 慢：检查 `ASKME_AI_VERIFIER_TIMEOUT_MS/MAX_RETRIES` 环境覆盖是否把 verifier 改回了短超时+重试。

## 预期 Commit subject

`fix(rag): scope profile-overview evidence to material and slow-answer gate`
