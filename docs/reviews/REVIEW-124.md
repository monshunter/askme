# REVIEW-124：SPEC-002 Query-understood RAG Spec Review

被审制品：`SPEC-002`

Revision：`sha256:7d244410013da091e43a15969b04287ba61f29de135828f096f209c377fa98c6`

Verdict：`PASS`

## 审查结论

- 修订直接覆盖 `RAG_BUGS.md` 与生产函数复现的失败：`你在哪家`、`哪家公司`、`什么职位` 等问句片段不再是 Explicit Entity，`我/你/本人/候选人/这个人` 统一解析为当前 `profile_owner`。
- Spec 将 intent、subject、knowledge scope、explicit entities、constraints 和 requested fields 分开，Known constraint 不再成为 answer aspect，Unknown field 不再进入 Catalog lookup，概念边界一致且可测试。
- “Explicit entity 必须严格 Grounding”与“没有 Explicit entity 时必须检索待求字段”形成对偶不变量；Askme/OneCat 串实体防护、unknown/ambiguous none/partial 和受控会话指代均被保留，没有降低上一轮安全边界。
- 时间合同明确使用 inclusive interval overlap，单年边界规范化、未知区间交给 Answerability，避免 exact endpoint 过滤和解析失败伪装成无证据。
- Query Semantics 只能缩小或排序当前授权集合，不能选择 tenant、提升 visibility 或扩大 Entity Scope；Public Chat 的实体存在性与正文隔离不受影响。
- 新增 `AC-QUERY-001..004`、`AC-EVAL-002` 与 `AC-ACCEPT-004`，能够分别验证查询解析、条件门禁、Provider fallback、时间覆盖、真实 Provider/API 和双端浏览器结果；未把实现细节写成产品要求。
- 更新复用现有 `SPEC-002`，没有创建平行产品合同、Entity Catalog 或 Knowledge Graph；Deep Agent、认证、发布模型和生产扩容仍在明确非目标内。

下一路由：使用 `autogo-solution-design` 更新 `DESIGN-005`，把已批准 Query Semantics 落到现有 Query Planner、Entity Resolver、Hybrid Retriever、Answerability、Trace 与评测边界，再进行 Design Review。
