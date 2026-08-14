# 2026-08-14 Hybrid Agentic RAG V2 设计交接

## 关联工作

- Objective：`OBJ-015`
- Plan：[PLAN-020](../plans/PLAN-020.md)
- Branch：`feat/hybrid-rag-v2`
- 类型：跨会话 handoff

## 已完成

- 通过逐项 grilling 固化 Hybrid Agentic RAG V2 的来源、chunk、Embedding、pgvector、Rerank、Evidence、Claim、Repository 文档、权限、评估和失败语义。
- 创建 [Hybrid Agentic RAG V2 工作流](../../workflows/hybrid-agentic-rag-v2.md) 与根 `NOTES.md`。
- 更新并通过 [SPEC-002](../specs/SPEC-002.md) Review，直接替换 V1 检索合同。
- 更新并通过 [DESIGN-005](../architecture/DESIGN-005.md) Design Review；`REVIEW-103` 的 Notes 要求实现前验证 Rerank endpoint，并记录 pgvector image digest。
- PLAN-020 Phase 1 已完成；本会话未修改 migration、配置、依赖、服务端、前端、测试或运行环境。

## 未完成

- PLAN-020 Phase 2–5 全部未领取：版本化索引、Repository 文档、Hybrid Retrieval、Claim/Citation、Trace、120 题门禁、部署和真实账号验收都尚未实现或验证。
- Objective 保持 `正在处理`，Plan 不关闭、不提交完成结论。

## 下一恢复点

1. 读取 PLAN-020、SPEC-002、DESIGN-005 与 REVIEW-103，并重新对账 Git/指令链。
2. 从 Item 2.1 开始，以失败测试保护独立 Embedding/Rerank Provider 和全部配置默认值。
3. Provider 实现前只验证 `ASKME_RERANK_MODEL_API_BASE_URL` 的 contract/endpoint 可用性，不打印或持久化 Secret；不得从 Embedding URL 猜测 Rerank endpoint。
4. 进入 migration 前记录当前业务表计数，并以 `pgvector/pgvector:pg18` 的实际 digest 固定本地运行依赖。

## 当前验证边界

- 已执行文档索引重建与 `git diff --check`。
- 已确认 `pgvector/pgvector:pg18` manifest 当前可获取。
- 未运行应用测试、数据库 migration、Compose 部署、Provider 实调、Golden Dataset 或浏览器 E2E；这些不得视为 PASS。
