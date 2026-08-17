# 2026-08-17：预览「自我介绍」类问题证据不足修复与 RAG 概述兜底

记录类型：delivery

路由：Fast

## 目标与范围

修复 Candidate Agent 预览中「麻烦你做一个自我介绍」返回 `INSUFFICIENT_EVIDENCE`（0 引用）的问题。用户预期这类概述问题应能基于职业知识库给出有引用的回答（知识库中确有「职业概述」知识条目与简历/Profile 材料）。

本次变更只涉及 RAG 检索代码与本地环境配置；不修改来源权限、索引 schema、模型 Provider、Secret、数据库 schema、UI 或生产环境。

## 根因（两层叠加）

- **环境层**：2026-08-17 10:09 启动的 web/worker 容器中 `ASKME_EMBEDDING_MODEL_API_KEY/BASE_URL`、`ASKME_RERANK_*` 为空（真实凭证在 `~/.env`，启动时未通过 `--env-file` 注入），所有检索出现 `embedding_fallback + rerank_fallback`，vector/rerank 路由失效。同时该时段的资料索引也受影响：`小马田-职业profile.md` 的 RAG source 于 10:10 以 `EMBEDDING_NOT_CONFIGURED` 失败，材料 chunks 丢失（`materials.status` 仍为 `indexed`，但 `rag_source_versions.state='failed'`、parent/child 为 0）。
- **代码层**：即使 vector/rerank 恢复，「自我介绍」也答不出——planner 将 `mustTerms` 设为字面词「自我介绍」，全库无任何 chunk 含该词；vector top-30 被仓库文档（easyinterview 等 12 个仓库、约 1.1 万 chunk）完全淹没，简历/Profile 材料（约 50 chunk）排到 300+ 名，永远进不了候选集；coverage judge 因字面信号缺失判 none，answerability gate 判 unsupported，落入兜底文案。即：**问法措辞与知识库字面不重叠的概述类问题必然返回证据不足**。

## 本次实际完成

- `src/server/rag/rag-query-service.ts`：在 `retrieveRagForQuestion` 增加**概述兜底检索**——当 answerability gate 返回 `coverage=none` 且计划为 `career_summary`（或 `general_career` + `profile_owner`）、无必需实体时，用语言匹配的概述化语义查询（「候选人的职业概述、主要工作经历、核心技能与项目总结」）重检，`desiredEvidenceTypes` 限定为 material/knowledge（避免仓库淹没材料），清空字面 `mustTerms/exactPhrases` 与实体信号；gate 通过才采用，否则保留原 none 结果并标记 `overview_fallback`（trace 可观测）。兜底不改变缺失/歧义实体的拒绝路径（PLAN-024 防无关误答防线不变，gate 仍是最终校验）。
- `src/server/rag/rag-query-service.test.ts`：新增 4 个单测——概述兜底触发并用 material 证据回答、有必需实体不触发、兜底后 gate 仍拒则保持 none、英文问题用英文概述查询。全量 Vitest `107 files / 440 tests`、ESLint、tsc 全绿。
- 本地环境：`scripts/docker-up.sh -d` 重建 web/worker，`~/.env` 的 embedding/rerank 凭证正确注入，`/api/health/ready` 全绿（含 runner/artifact）。

## 数据修复

- 将 `小马田-职业profile.md` 的 failed source（`61ee9942-…`）重排队为 `queued`，worker 使用已恢复的 embedding 重新索引成功：`active / parent_count=9 / child_count=24`。另一条 `RAG_SOURCE_REVOKED` 的 stale failed source（已删除的旧材料）未动。

## 验证（真实 API，candidate `xingkongdeyu2023@gmail.com`）

- 「麻烦你做一个自我介绍」：HTTP 200、无 error code，回答「我是一名高级后台开发工程师，2017 年至 2021 年期间在欢聚时代、广州探迹等互联网公司工作…我拥有多个开源项目，包括 Askme、AutoGo、Ferry、EasyInterview、GOAT…」，1 个 Citation（小马田-职业profile.md）；Trace `coverage=full / roundCount=2 / degradations=[overview_fallback] / intent=career_summary / subject=profile_owner / selectedEvidence=3`。
- 回归：「富途控股云原生平台工程师职责成就」仍正常回答（1 Citation，`coverage=full`，无 fallback 标记）；「字节跳动算法工程师经历」（知识库外实体）仍正确返回 `INSUFFICIENT_EVIDENCE`、0 引用。

## 恢复方式

- 代码层可直接回退本次 Commit；`rag-query-service.ts` 的兜底逻辑是唯一行为变更点。
- 若再次出现 `embedding_fallback/rerank_fallback`：检查容器 `ASKME_EMBEDDING_MODEL_API_*`、`ASKME_RERANK_*` 是否为空，务必用 `scripts/docker-up.sh`（带 `--env-file ~/.env` 分层）启动，不要用裸 `docker compose up`。
- 若材料 RAG source 再次 `failed`：将对应 `rag_source_versions` 状态改回 `queued` 让 worker 重试，或执行 `npm run rag:rebuild` 全量重建。

## 预期 Commit subject

`fix(rag): answer overview questions from material corpus fallback`
