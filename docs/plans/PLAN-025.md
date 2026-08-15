# PLAN-025：交付成熟 Entity-grounded RAG 与真实质量闭环

## 目标

基于 `RAG_NOTES.md` 的问题与当前 Hybrid Agentic RAG V2 事实，将 Askme 升级为实体身份先于语义相似度、能够可靠拒答、可真实评测与诊断、可安全全量重建的成熟 RAG 系统，并在本地真实 Compose、真实 Provider、Candidate Preview 和 Public Chat 中闭环验收。

## 范围

本 Plan 更新现有 `SPEC-002` 与 `DESIGN-005`，复用当前权限过滤、版本化 pgvector 索引、Hybrid Retrieval、Rerank、Claim Verifier、Citation Validator、Trace 与反馈边界；新增授权 Entity Catalog 投影、显式实体解析与硬检索范围、实体上下文化 Chunk、可靠 Answerability/Coverage、诚实的离线与真实 Provider 评测，以及知识组织与派生索引全量重建入口。项目尚未上线，不保留旧检索策略或旧派生索引兼容路径；账号、原始材料、Repository、权限、Publication 和会话等业务事实仍不得被派生数据重建误删。

## Phase 1：固化成熟 RAG 合同与系统设计

- [SPEC-002：成熟 Entity-grounded RAG 与代码仓库 Agent 产品合同](../specs/SPEC-002.md)
- [DESIGN-005：Entity-grounded RAG V3 与隔离源码分析系统设计](../architecture/DESIGN-005.md)

- [x] 1.1 将实体一致性、未知实体拒答、局部可回答、查询改写保真和真实评测门禁写入产品合同并完成 Spec Review
- [x] 1.2 将授权 Entity Catalog、检索前 Scope、上下文化索引、Answerability、重建与观测方案写入系统设计并完成 Design Review

## Phase 2：交付实体化知识与可重建索引

- [x] 2.1 用失败测试固化知识组织实体、别名、证据绑定和安全解析边界
- [x] 2.2 让 Material Knowledge 与 Repository 身份形成单一授权 Entity Catalog 投影
- [x] 2.3 将来源实体上下文写入 Chunk 检索表示并提供知识组织与 RAG 派生数据全量重建入口

## Phase 3：交付检索前实体约束与可靠 Answerability

- [x] 3.1 用失败测试覆盖 Catalog-first 无类型显式实体、未知项目、同名/别名、多实体局部回答以及唯一/歧义会话指代
- [x] 3.2 在 Query Planning 后、Hybrid Retrieval 前合并授权 Alias 命中与 Planner mention，复用上一轮已解析实体焦点并执行来源硬约束或确定性拒答
- [x] 3.3 修复 Coverage/冲突误判，统一 Candidate Preview 与 Public Chat 的结果、Deep 路由和诊断 Trace

## Phase 4：建立可信质量门禁

- [x] 4.1 将合成 Golden Dataset 收敛为真实核心组件评测，并加入无类型 Alias、实体混淆、唯一/歧义指代、权限和降级回归集
- [x] 4.2 建立真实 PostgreSQL 与真实 Planner、Embedding、Rerank、Answer、Verifier 的 Provider 评测入口
- [x] 4.3 通过定向测试、全量测试、Lint、Typecheck、Build、Surface Matrix 与 Diff 检查

## Phase 5：全量重建、部署与真实端到端验收

- [x] 5.1 审计并记录本地数据与运行状态，通过项目入口重建知识组织和派生 RAG 索引并激活唯一新版本
- [x] 5.2 在真实 API 验证未知实体拒答、已知实体回答、多实体局部覆盖、权限隔离、Citation 和 Trace
- [x] 5.3 在真实浏览器验证 Candidate Preview 与 Public Chat 的回答、来源、会话持久化、错误反馈和 Console/Network 状态

## Phase 6：审查并收口交付

- [x] 6.1 完成 Change Review，并对账合同、实现、评测、数据重建、部署与 E2E Evidence
- [x] 6.2 同步正式制品与索引，关闭 Objective 并创建原子 Commit
