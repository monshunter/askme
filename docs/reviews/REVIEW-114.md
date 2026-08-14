# REVIEW-114：PLAN-023 DeepSeek Flash 降本与 LLM 核心链路 Change Review

Verdict：`PASS_WITH_NOTES`

- Objective：`OBJ-018`
- Plan：[PLAN-023](../plans/PLAN-023.md)
- Operation：[OP-007](../operations/OP-007.md)
- 审查分支：`opt/deepseek-flash-cost-reduction`
- 审查日期：2026-08-14

## 审查范围

审查 Code AI profile 从 `deepseek-v4-pro` 到 `deepseek-v4-flash` 的当前默认配置、consumer fixture、自动化、Compose 部署、实际容器环境、真实 DeepSeek、资料处理、RAG、Candidate/Public Agent、Code Agent、BoxLite、浏览器与清理结果。历史 Operation、AI provider、API base URL、Secret、Embedding、Rerank、模型预算、数据语义、权限、生产发布和范围外产品修复不在本次变更范围；既有未跟踪 `NOTES.md` 不进入 Diff 或 Commit。

## Findings

没有阻断或需要继续修复的 correctness、安全、兼容、模型选择、部署或验收发现。

审查和 E2E 中发现并已 Reconcile 的问题：

1. `smoke:agent-runtime-acceptance` 把 Copybook 概览 RAG Citation 硬编码为旧的 `README.md/package.json`，当前固定 revision 会合法选择 `README.zh-CN.md`、`AGENTS.md` 或架构文档。断言已收敛为稳定不变量：1–2 个来源中必须至少有一个 README/overview 主来源，其余只能来自受控概览/架构 allowlist；Repository、固定 revision、语言、Citation 数量和 Deep 验收均未放宽。修订后同一场景 PASS。
2. 直接 AI check 首次从 `migrate` 临时容器运行时安全返回 `AI_NOT_CONFIGURED`，原因是该服务按设计只拥有数据库/bootstrap 环境而不持有运行时 AI Secret。改从已部署 `web` 配置 owner 运行后真实 `deepseek-v4-flash` check PASS；未把环境边界错误归因于模型。
3. 部署前 host-native Runner 为 stale；Compose 重建后通过项目 `scripts/agent-runner.sh` 恢复，最终 runner/artifact/BoxLite/provenance 均为 ready。首次 `nohup` 尝试没有保持进程且未产生应用副作用，随后使用受控前台统一会话运行并保持 PID `79888`。

## 正确性、范围与兼容结论

- `.env.example`、`docker-compose.yml` 与 `src/server/config.ts` 的 Code 默认模型一致为 `deepseek-v4-flash`；配置测试、Code contract、sandbox response 和 Dossier fixture 同步更新。thinking、context window、max tokens、timeout、round/tool budget 与 profile id 都未变化。
- 全仓 `deepseek-v4-pro` 剩余引用只属于当前变更说明和 `OP-006` 历史 Evidence；`docker compose config` 以及 Web/worker 实际环境的 Router、RAG、Code、Planner、Verifier 全部为 `deepseek-v4-flash`。
- `smoke-agent-runtime-acceptance` allowlist 调整只修复固定 revision 的来源集合漂移，没有改变应用运行代码、路由、证据授权或回答验收强度。
- 无 Migration、Secret、权限、持久数据语义或生产变更；部署使用既有保留数据入口，volume 创建时间未变化。E2E 新增 Conversation/Message 是明确验收记录，其他原业务计数保持；临时浏览器会话和上传 Material 已精确删除。

## 当前 Evidence

- 工程门禁：Vitest `101 files / 360 tests`、ESLint、Next typegen + TypeScript、production build `31 / 31`、Surface Matrix `22 pages / 68 API routes / 76 methods / 29 verification entrypoints` 与 `git diff --check` PASS。
- Runtime：migrate exit 0、Web healthy、worker/Runner running；live 为 `live`，ready 顶层和 Code Agent capability 为 `ready`，database/migration/worker/runner/artifact/BoxLite/provenance 均为 `ready`，AI 为 `configured`；Web/worker/migrate 当前错误日志为空，microVM 残留为 0。
- 真实 LLM：AI availability 明确返回 `deepseek-v4-flash`；资料组织 usage 为 Flash success；RAG Generator/Verifier 2 个质量用例 PASS；Router、Candidate/Public answer 和 suggestions usage 全部为 Flash success。
- 真实 Agent：Candidate/Public Deep run `b8b32d59-8bce-4d10-9b3a-3ad638219388`、`6c97e5bd-4adc-4117-993f-678ccf620be2` 均 completed，configured/actual model 都是 `deepseek-v4-flash`，safe error 为空、cleanup timestamp 存在，源码 Citation 和路由审计成立。
- Browser：Candidate 可见 RAG/Deep 回答与 5 个源码来源；Public 新会话可见 Flash RAG 回答与 2 个公开来源；`clientWidth=scrollWidth=1280`，console warning/error 为 0。

## Notes

- Material 删除的既有实现会 fail closed 地阻止已删除来源进入检索和历史 Citation，但不会把对应 `rag_source_versions` 状态同步为 revoked。本轮 fixture 已按精确 source id 撤销并重算 active index，`expected_source_count=92 / active=92`；该生命周期缺口不是模型切换回归，也不影响本 Plan 的模型、权限或回答结论，后续应作为独立 Objective 修复。
- 两个真实 Deep run 都在初始输出上触发一次 `CODE_ANSWER_CITATION_HASH_INVALID` Host 拒绝，并在当前 Flash budget 内收敛为 answered；这证明 correction/Host validation 路径有效，不代表首次生成一次通过。长期成本评估仍需外部账单或运行期 usage 汇总，本 Review 只证明模型已切换且核心链路当前可用。

## 结论

当前 Diff、配置、自动化、已部署运行版本、真实 LLM/RAG/Agent/Code Agent、浏览器和清理 Evidence 与 `OBJ-018 / PLAN-023` 一致。Notes 不阻断降本模型切换、权限、可恢复性或核心链路验收；`PLAN-023 5.1` 可以完成并进入 `autogo-change-close` 对账、索引、关闭与原子提交。
