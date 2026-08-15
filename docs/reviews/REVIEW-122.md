# REVIEW-122：PLAN-025 Entity-grounded RAG V3 最终 Change Review

Verdict：`PASS_WITH_NOTES`

- Objective：`OBJ-020`
- Plan：[PLAN-025](../plans/PLAN-025.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- Operation：[OP-009](../operations/OP-009.md)
- 审查分支：`feat/mature-rag-system`
- 审查日期：2026-08-15

## 审查范围与结论

审查从 Knowledge organization 的 typed entity、授权 Entity Catalog、Catalog-first Query detection、Planner merge、会话实体焦点、四路 hard scope、Answerability/Coverage、Claim/Citation、Deep 选择、Trace、重建入口、离线/Provider/API 评测到 Candidate/Public 浏览器结果的完整链路。当前 Diff 与 `SPEC-002`、`DESIGN-005` 一致，没有阻断 correctness、安全、数据、权限、恢复或范围发现，可以关闭 `PLAN-025`。

## Reconcile Findings

1. 用户追问暴露了初版只有带类型 mention、缺少 Catalog-first 无类型 Alias 和受控上下文焦点的不足。实现已增加最长授权 Alias 扫描、短 Alias 嵌套消歧、未知 CamelCase fail-close，以及只从上一轮安全 Trace 读取实体焦点。
2. 上一轮 `resolved Askme + missing MoonBase` 不能把后续“它”静默绑定 Askme。当前只有“恰好一个 resolved 且 missing/ambiguous 均为空”才是 unique，其余按 ambiguous 在 round 0 结束。
3. 首次真实 API 验收发现 Host 已输出 `contextual_reference_ambiguous` 后仍调用 LLM Router，模型用 `ambiguous_repository` 把结果覆盖成 `REFUSED`。两个 consumer 现在在 entity gate stop 时记录 deterministic RAG route audit、跳过 Router/Embedding/Retrieval/Rerank/Deep，并由回答层持久化 `INSUFFICIENT_EVIDENCE`；复跑 Candidate/Public HTTP 场景通过。
4. 原离线脚本不能证明 Provider outcome；现在明确标记 synthetic route adapter 和局限，同时用独立真实 PostgreSQL/Provider 21-case 与真实 HTTP 11-case 证明最终行为。Embedding/Rerank 故障使用受控注入验证生产 fallback，不把单元测试冒充真实链路。

## 正确性与权限结论

- Entity identity 来自当前 caller 可见的 Evidence-bound Knowledge Item 与当前 Repository record，模型不能创建或用相似度替换身份；Public Catalog 不投影 private/agent-only 实体。
- 原始 Query 的显式 Catalog Alias 与合法 Planner mention 合并后强制保留在 standalone/semantic query。Resolved strict entities 对 exact、lexical、vector、structured 四路使用同一 source scope；missing/ambiguous 唯一实体不启动检索。
- 多实体允许 union scope 但 Coverage 上限为 partial，缺失名称来自用户已提供文本；回答不能把已知实体事实复制给未知实体。
- Deep 只接受 Entity Resolver 唯一解析的 Repository。未知 `MoonBase` 源码问题在真实 API 中创建 0 个 Analysis Run。
- Claim Verifier、Citation Validator、实时 visibility/checksum/source state 校验继续独立生效；Public DTO 不暴露内部 chunk ID，Visitor 不读取 Retrieval Trace。

## Evidence

- 数据重建：`4 materials → 32 knowledge_items / 86 entity values / 92 active sources / 417 active children`，唯一 active index `388863ea-4cf2-40e6-8419-3e60d3571bf7` 使用 `source-entity-context-v2`；业务 owner 计数保持。
- 自动化：Vitest `104 / 403 PASS`，ESLint、TypeScript、Build `31 / 31`、Surface Matrix 与 Diff 检查通过。
- 离线核心：120 retrieval、12 entity-grounding、10 entity-query 全部无失败，权限泄露为 0；provisional coverage 只作诊断，不冒充最终 Gate。
- 真实运行时：21/21 PASS，包含 19 条实体/上下文和 2 条 Provider 降级。
- 真实 API：11/11 PASS，Candidate/Public 的 grounded、partial、unknown、ambiguous、Citation/Trace 与 Deep 隔离均成立。
- 真实浏览器：Candidate/Public 的回答、证据缺口、Citation 展开、Trace、刷新持久化成立；两页 Console 日志均为 0。
- 部署：Compose ready，database/migration/worker ready，AI configured，active Analysis Run 为 0。

## Notes

- 当前真实环境只有 4 个 Material、32 个 Knowledge Item 和 417 个 active Child；本 Review 不声称已经证明生产容量、100k vector 阈值或跨租户负载。
- `provisionalCoverageAgreement=0.541666...` 不是发布失败，因为最终 Coverage 由真实 Answerability Gate 拥有；该指标保留为后续优化启发式早停的诊断信号。
- Code Agent runner/artifact/BoxLite/provenance 的既有 degraded 状态未恢复；它不阻断普通 RAG，但在恢复前不能把 Deep Analysis 描述为当前可用能力。

## 结论

`PASS_WITH_NOTES`。Notes 不影响本 Objective 的成熟 RAG 成功标准、安全、验收或恢复；可以进入 `autogo-change-close`，同步索引、关闭 Objective 并创建原子 Commit。
