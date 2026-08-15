# PLAN-026：交付 Query-understood RAG 与无实体问题真实闭环

## 目标

基于 `RAG_BUGS.md` 的现象、当前 Entity-grounded RAG V3 实现和真实运行基线，将查询理解从单一实体提取升级为能够区分意图、主体、检索范围、显式命名实体、约束和待求字段的最小语义合同；只对用户明确指定且必须归属的实体执行严格 Grounding，无实体问题按授权知识检索答案，并在本地真实 Compose、真实 Provider、Candidate Preview 与 Public Chat 中闭环验收。

## 范围

本 Plan 更新现有 `SPEC-002` 与 `DESIGN-005`，复用当前授权 Entity Catalog、Hybrid Retrieval、Answerability、Claim/Citation、Trace 与知识重建边界；覆盖自我主体指代、无显式实体的经历/项目/技能问题、显式已知与未知实体、时间区间、待求字段、多轮实体指代及降级行为。允许备份后重组 Knowledge 与重建派生 RAG 索引，但不得删除账号、原始 Material、Repository、Publication、权限、会话或其他业务事实。代码仓库 Deep Agent、认证、发布模型和 UI 视觉重构不在本 Plan 范围内。

## Phase 1：固化查询语义合同与最小系统设计

- [SPEC-002：成熟 Entity-grounded RAG 与代码仓库 Agent 产品合同](../specs/SPEC-002.md)
- [DESIGN-005：成熟 Entity-grounded RAG 与隔离源码分析系统设计](../architecture/DESIGN-005.md)

- [x] 1.1 对账问题复现、查询类别、当前数据流与回归边界
- [x] 1.2 将条件实体门禁、主体、检索范围、约束和待求字段写入产品合同并完成 Spec Review
- [x] 1.3 将 Query Understanding、Host 校验、检索与 Answerability 协作方案写入系统设计并完成 Design Review

## Phase 2：交付可验证的 Query Understanding

- [x] 2.1 用失败测试固化无实体、显式实体、自我主体、时间范围和待求字段的对偶行为
- [x] 2.2 实现确定性与 Provider 协作的查询语义解析，并阻止问句、代词和待求字段成为严格实体
- [x] 2.3 将显式实体条件门禁、会话实体焦点和安全降级统一到生产 Query Plan

## Phase 3：闭环检索、Answerability 与回答

- [x] 3.1 让检索查询使用知识范围、时间约束和待求字段，同时保持授权与显式实体 Scope 不变量
- [x] 3.2 让 Answerability 与 Claim 生成按约束和待求字段验证覆盖，正确处理区间重叠与局部证据缺口
- [x] 3.3 统一 Candidate Preview、Public Chat、Deep 路由与 Retrieval Trace 的结果和诊断语义

## Phase 4：建立防回摆质量门禁

- [x] 4.1 扩充无实体与显式实体的成对回归集，覆盖经历、项目、技能、时间、未知实体和多轮指代
- [x] 4.2 通过生产核心函数、真实 PostgreSQL 与真实 Provider 评测召回、拒答、覆盖和 Citation
- [x] 4.3 通过定向测试、全量测试、Lint、Typecheck、Build、Surface Matrix 与 Diff 检查

## Phase 5：重建、部署与真实端到端验收

- [x] 5.1 备份并对账本地业务数据，重组 Knowledge、重建并原子激活派生 RAG 索引
- [x] 5.2 在真实 API 验证无实体时间经历、项目枚举、显式实体命中/缺失、权限、Citation 和 Trace
- [x] 5.3 在真实浏览器验证 Candidate Preview 与 Public Chat 的回答、来源、会话持久化及 Console/Network 状态

## Phase 6：审查并收口交付

- [x] 6.1 完成 Change Review，并对账合同、实现、评测、数据重建、部署与 E2E Evidence
- [x] 6.2 同步正式制品与索引，关闭 Objective 并创建原子 Commit
