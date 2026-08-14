# PLAN-024：修复公共 Agent 无关证据误答

## 目标

当 Candidate 当前授权 Evidence 不支持问题的核心实体时，公共 Agent 必须明确返回证据不足，不得把其他项目的真实内容拼成答非所问的回答；在保留现有本地数据的前提下完成工程回归、部署与“牛鼻子”公开 Agent 真实端到端验收。

## 范围

本 Plan 修复 Hybrid Agentic RAG V2 的 Host Coverage 判定及其自动化，复用现有 `insufficient_evidence`、Citation、公开游客会话和本地 Compose 边界；不改变来源可见性、索引数据结构、Embedding/Rerank/Chat Provider、Deep Analysis、Agent UI、Secret、生产环境或 Candidate 资料。部署仅更新本机 `askme-local` 服务并保留 PostgreSQL、上传和 Repository Artifact 数据。

## Phase 1：固化核心实体相关性门禁

- [SPEC-002：职业知识与代码仓库 Agent V2 产品合同](../specs/SPEC-002.md)

- [x] 1.1 用回归测试证明 Askme 核心实体不能被 OneCat 等无关授权 Evidence 判为可回答
- [x] 1.2 让 Host 在核心实体与 must term 均无 Evidence 支持时收敛为 `none`
- [x] 1.3 回归相关问题、部分覆盖、同义改写与多轮指代，避免把精确匹配门禁扩大为全文字面匹配

## Phase 2：完成工程验证

- [x] 2.1 通过 RAG Coverage、Answer、Public Chat 相关定向测试
- [x] 2.2 通过全量测试、Lint、Typecheck、Build、Surface Matrix 与 Diff 检查

## Phase 3：保留数据部署与真实验收

- [x] 3.1 记录部署前运行和数据状态，通过项目入口保留数据重建本地 Compose 服务并验证健康与数据保留
- [x] 3.2 在“牛鼻子”公开 Agent 新会话中验证 Askme 问题返回证据不足、零 Citation，OneCat 相关问题仍正常回答
- [x] 3.3 用真实浏览器验证新会话与 OneCat 后追问 Askme 两种路径的可见结果、会话持久化、网络和 Console 状态

## Phase 4：审查并收口交付

- [x] 4.1 完成 Change Review，并对账实现、测试、部署与真实 E2E Evidence
- [x] 4.2 同步正式制品与索引，关闭 Objective 并创建原子 Commit
