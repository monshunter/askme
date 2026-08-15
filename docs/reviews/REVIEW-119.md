# REVIEW-119：DESIGN-005 成熟 Entity-grounded RAG Design Review

被审制品：`DESIGN-005`

Revision：`sha256:e44f3d6c29135b3b5179166b906700e5942c017a3fa7bcff1a5b4b9b8b66c101`

Verdict：`PASS_WITH_NOTES`

## 审查结论

- 设计直接更新现有 RAG owner，没有新增平行检索服务。PostgreSQL、pgvector、现有 worker、四 Route、RRF/Rerank、Claim/Citation、Trace 与 Code Agent 边界继续复用。
- Entity Catalog 使用 `knowledge_items.entities + knowledge_evidence + knowledge_sources + materials + repositories` 的请求级授权投影，不创建独立 registry 表；实体数据与 Evidence、Repository 事实源之间没有双重 owner。
- Public Catalog 的 SQL 在读取阶段排除 private/agent-only rows，missing 不会泄露未授权实体；Entity Scope 在四 Route 共用 eligible CTE 中执行，只能收窄当前授权集合。
- Material canonical/alias 需要 Host 验证实际出现在关联 Evidence 或属于有限格式变体；模型不能用 organization 输出注入无证据 alias。Repository ID 保持稳定身份，同一 project 的 Material source 可在唯一 alias 命中时合并，多个同名 Repository 保持 ambiguous。
- Query Planner 的 typed mention 与 deterministic mention 合并，Host 强制保留原问题 explicit text；Planner rewrite、Router、Embedding 和 Rerank 都不能改写身份或扩大 source scope。
- resolved、missing、ambiguous、soft 与多实体 union/partial 行为明确。Technology 保持 soft term，避免把通用技术问题过度 hard filter；project/product/repository/organization/person 使用 strict identity。
- Answerability 采用“确定性 provisional Judge 驱动一次补检 + 最终一次 Verifier-profile Gate”的最小方案：既避免每轮多一次模型调用，也在生成前绑定 aspect、entity 和 Evidence。任意否定词不再触发 conflict，合法 conflict 必须引用同一 aspect 的不同 evidence family。
- Gate 失败独立为 `AI_ANSWERABILITY_FAILED`，Generator 只接收 Gate 选中的 Evidence；`none` 不再掩盖 Provider/schema failure，且不相关上下文污染显著收窄。
- `knowledge_items.entities` 是唯一新增持久字段；context prefix 版本提升会强制新 index，单一 dry-run-first 维护入口负责重新组织 Materials、重建与激活，不删除账号、原始 Material/Artifact、Repository、权限、Publication 或会话。
- 评测分为调用生产纯函数的离线层、至少 12 case 的真实 PostgreSQL/Provider 隔离层和真实账号 API/浏览器验收，修正了旧脚本把 tag/关键词当系统 outcome 的 Evidence 缺陷。
- Deep 路由只把确定性源码语法转为 explicit mention，仍需 Entity Resolver 唯一解析同一个授权 Repository；不会恢复“唯一 Repository 猜测”漏洞。

## Notes

- 请求级 Catalog 投影在当前 4 个 Material、3 个 Repository 的规模下比新增持久 registry 更简单且一致。实现应记录 projection latency 与 entity count；只有实际 P95 或规模证据表明 SQL/JS 投影成为瓶颈时，才另建受版本和授权约束的物化索引。
- Final Answerability 增加一次 Chat 调用是有意的质量成本。实现应复用 Verifier Profile、严格限制为最终 Evidence Pack 的 topN Parent，并在 Trace/usage 中记录 latency/token；不得把失败静默降级为旧字面 Judge。

Notes 不影响 Spec、安全、恢复或验收，可以进入实现。

下一路由：使用 `autogo-tdd` 从 PLAN-025 Phase 2.1 建立 Knowledge entity schema、Evidence 校验和 Catalog projection 失败测试，再用 `autogo-change-implement` 完成最小实现。
