# PLAN-023：统一 DeepSeek Flash 模型并回归 LLM 核心链路

## 目标

将 Askme 当前仍使用 `deepseek-v4-pro` 的 Code AI profile 及其有效配置、测试和 Smoke fixture 统一切换为 `deepseek-v4-flash`，在保留本地数据的前提下重启服务，并用真实模型回归直接 LLM、RAG、Candidate/Public Agent 与 Code Agent 核心链路，确认降本不改变既有产品行为和权限边界。

## 范围

本 Plan 修改当前生效的默认模型和与该默认值绑定的自动化，不改写历史 Operation Evidence；不改变 AI provider、API base URL、Secret、Embedding、Rerank、模型参数预算、RAG/Agent 路由、数据语义、权限、公开行为或生产环境。部署范围仅为本机 `askme-local` Docker Compose，保留 PostgreSQL、上传与 Repository Artifact 数据。

## Phase 1：统一当前模型配置

- [SPEC-001：Askme 产品行为规范](../specs/SPEC-001.md)
- [SPEC-002：Repository Wiki 与 Code Agent V1](../specs/SPEC-002.md)

- [x] 1.1 将 Code AI profile 的当前默认值及绑定测试和 Smoke fixture 统一为 `deepseek-v4-flash`
- [x] 1.2 审计源码、配置和运行入口，确认没有仍会选择 `deepseek-v4-pro` 的有效路径

## Phase 2：完成工程验证

- [x] 2.1 通过模型配置与 Code Agent 定向测试
- [x] 2.2 通过全量测试、Lint、Typecheck、Build、Surface Matrix 与 Diff 检查

## Phase 3：保留数据重启服务

- [x] 3.1 记录部署前运行与数据状态，并通过项目入口重建和重启本地 Compose 服务
- [x] 3.2 确认 Web、worker 与 Code Agent 实际运行模型、健康、迁移、日志和数据保留状态

## Phase 4：回归真实 LLM 核心链路

- [x] 4.1 用真实 DeepSeek 验证直接 LLM availability
- [x] 4.2 用真实 DeepSeek 验证资料处理、组织与检索索引链路
- [x] 4.3 用真实 RAG 和浏览器验证 Candidate Agent 与 Public Agent 的回答、Citation、Verifier 与权限投影
- [x] 4.4 用真实 Code Agent 验证 Repository Deep Analysis、Host 校验、持久化与 microVM 清理

## Phase 5：审查并收口交付

- [x] 5.1 完成 Change Review，并对账配置、自动化、运行和 E2E Evidence
- [x] 5.2 同步正式制品与索引，关闭 Objective 并创建原子 Commit
