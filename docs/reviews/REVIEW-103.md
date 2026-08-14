# REVIEW-103：DESIGN-005 Hybrid Agentic RAG V2 Design Review

Verdict：`PASS_WITH_NOTES`

- Objective：`OBJ-015`
- Plan：[PLAN-020](../plans/PLAN-020.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md) `sha256:20ac2cd608980f6e53add7f77d427832df94b351fe9b370e12b23ef3c985e1b8`
- 审查日期：2026-08-14

## 边界与职责

- 设计复用现有 PostgreSQL worker、Repository artifact、visibility 与 Code Agent owner，新增组件围绕版本化索引和问答编排，没有建立第二套 Repository、权限或消息事实源。
- Repository Markdown/PDF 长期索引与原始源码 Deep Analysis 明确分离；Deep runner 的只读、不可变 revision、per-run microVM 和不持久化 reasoning 边界保持不变。
- Provider 不访问数据库，模型输出不直接持久化；Host 依次拥有授权、Evidence reload、Claim/Citation 校验和最终渲染。

## 数据、一致性与恢复

- global index version、source version、Parent/Child、Trace 和反馈各有单一职责，支持配置级全量重建和来源 revision 级原子激活。
- 检索 SQL 重新 join 当前 Material/Repository/Approved Projection 权限，不把索引 visibility 快照当作授权事实；强撤销不依赖向量物理删除。
- V2 迁移只新增/重建派生数据，历史消息保留，无法复核的旧 Citation 显式 revoked；没有要求 V1 双写或兼容回退。

## 检索、安全与复杂度

- deterministic 中文处理、四路召回、RRF、独立 Rerank、Evidence Judge、唯一补检和 Claim Verifier 的依赖顺序满足 Spec，且最多两轮避免自由 Agent 循环。
- pgvector exact cosine 与先过滤后排序适合当前规模；HNSW 只有容量/延迟达到阈值并经过 recall gate 后引入，没有预建 ANN 复杂度。
- Prompt Injection 通过无工具 Provider、结构化 schema、Host allowlist 和 Evidence delimiter 多层隔离；Trace 不复制正文或向量。

## Notes

- 阿里云官方 `qwen3-rerank` compatible endpoint 可能绑定 WorkspaceId；实现前必须用用户配置的 `ASKME_RERANK_MODEL_API_BASE_URL` 做无 Secret contract preflight，不能从 Embedding base URL 猜测或静默拼接 endpoint。
- `pgvector/pgvector:pg18` 镜像 manifest 当前可获取；实现部署时仍应记录实际 image digest，避免 tag 漂移。

## 结论

Notes 属于实现期依赖预检，不改变产品语义、数据模型或恢复方案。Design 满足 Spec，可以在后续会话从 PLAN-020 Phase 2 进入 TDD 实现。
