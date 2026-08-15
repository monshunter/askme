# REVIEW-118：SPEC-002 成熟 Entity-grounded RAG Spec Review

被审制品：`SPEC-002`

Revision：`sha256:7a70b5c20430aa3694e3e0be3d39b33141de4a39c4bd758443891b6b0fa504cb`

Verdict：`PASS`

## 审查结论

- Spec 把 `RAG_NOTES.md` 的“语义相似不等于实体相同”转化为 Askme 可验收行为：Entity Catalog 只投影当前 caller 授权的 Repository 与 evidence-bound Knowledge Item，Public Chat 不通过解析结果泄露私有实体。
- Entity Resolution 位于 Planner 后、Embedding 与四路检索前；显式实体独立保留，unknown、resolved、ambiguous 和 contextual reference 均有明确行为，且任何 Scope 只能缩小授权集合。
- 唯一未知核心实体直接 `none`，多实体允许在已解析 Scope 内形成 `partial`，禁止把已知实体事实复制给未知实体；Askme/OneCat 原始故障已有稳定验收表达。
- canonical/alias 只做确定性规范化精确映射，不使用向量 nearest neighbor；`one cat → OneCat` 与 `askme ≠ onecat` 的边界清楚，实体 identity 和事实 Answerability 没有混为一谈。
- Catalog 没有成为平行知识库：Material entity 必须由知识组织结果和 `knowledge_evidence` 支撑，Repository record 是 Repository identity owner，Candidate 展示编辑不会隐式创建新实体。
- contextual prefix 增加实体身份但不改 Citation 正文；prefix 版本化与派生索引全量重建要求足以防止新旧表示混用。
- Evidence Judge 的 Coverage 与 runtime 的 `refused/failed` 已分开，`conflicted` 限定为同一实体、方面和可比较事实，消除了“任意否定词导致冲突”的歧义。
- Deep 路由必须由 Entity Resolution 和确定性源码意图共同唯一确定 Repository，Router 不再能以模型猜测扩大源码分析范围。
- 评测合同明确区分生产核心函数离线评测、至少 12 个真实 PostgreSQL/Provider case 和真实账号最终验收，禁止用 tag/关键词硬编码 outcome 冒充端到端质量。
- 新增 `AC-ENTITY-001`–`003`、`AC-REBUILD-001`、`AC-TRACE-002`、`AC-ACCEPT-003`，并重新打开当前事实不能支持的 `AC-RAG2-005` 与 `AC-EVAL-001`；每项均可独立验证。

没有发现行为冲突、权限扩大、不可测试要求或不必要的通用 Knowledge Graph 范围。

下一路由：使用 `autogo-solution-design` 更新 `DESIGN-005`，明确 Catalog 投影、query scope、索引表示、重建、评测和迁移后再进行 Design Review。
