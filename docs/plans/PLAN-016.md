# PLAN-016：闭环 Agent 精准问答、Deep 路由与上下文推荐

## 目标

让 Candidate 与 Public Agent 根据问题和授权证据准确选择 RAG、Deep 或拒绝；回答只展示实际支撑最终陈述的来源；问答 Deep 不受 Askme 日次数配额限制；回答与推荐问题跟随当前用户问题语言；推荐问题首次具有引导性，后续由 LLM 随同一真实会话上下文更新并推进对话，并通过本地真实运行和浏览器现场验收。

## 范围

本 Plan 覆盖 Approved Wiki section 检索、RAG Citation 选择与投影、Router 决策可观测、Conversation Deep Analysis、问答 Deep 配额边界、回答与推荐语言一致性、Candidate/Public 会话级 LLM 推荐状态、API/UI、迁移、测试、部署与 E2E；不引入向量数据库，不建立 Token/积分计费，不移除滥用防护、并发控制、单次运行预算或 Repository Wiki 生成的资源控制。

## Phase 1：修订长期行为与系统边界

- [x] 1.1 修订回答精度、Citation 关联、RAG/Deep 路由、问答使用边界与会话推荐合同
- [x] 1.2 修订精确源码锚点选择、Router 观测与会话推荐状态设计
- [x] 1.3 完成 Spec 与 Design Review

相关合同：[SPEC-002](../specs/SPEC-002.md)、[DESIGN-005](../architecture/DESIGN-005.md)

## Phase 2：交付精准 RAG 与 Citation

- [x] 2.1 用失败测试固定 Repository 定位、section 相关性和精确源码锚点选择
- [x] 2.2 实现问题相关的 Evidence 排序与回答实际使用来源投影
- [x] 2.3 保存并验证可审计的 Router 决策结果
- [x] 2.4 固定并实现 RAG 与 Deep 回答跟随当前用户问题语言

## Phase 3：闭环无次数配额的问答 Deep

- [x] 3.1 用失败测试固定 Conversation Deep 不读取或消耗日次数配额
- [x] 3.2 实现 Candidate/Public Deep 准入与资源边界调整
- [x] 3.3 在真实 Code Agent 环境完成问题触发、异步运行、源码读取和 Citation 验收

## Phase 4：交付上下文推荐问题

- [x] 4.1 用失败测试固定首次引导问题、同一会话 LLM 后续推荐语义与当前问答语言
- [x] 4.2 实现 Candidate/Public 会话级推荐生成、持久状态与实时刷新
- [x] 4.3 完成推荐问题 API 与界面联动

## Phase 5：部署并现场验收

- [x] 5.1 完成全量静态、单元、集成与 surface 门禁
- [x] 5.2 保留数据重部署本地 Compose 并验证运行健康
- [x] 5.3 在真实 Candidate/Public 浏览器会话验收精准 Citation、Deep Run、问答语言一致性与 LLM 动态推荐

## Phase 6：对账并关闭交付

- [x] 6.1 完成 Change Review 与必要 Reconcile
- [x] 6.2 对账 Spec、Design、Plan、Progress、运行 Evidence 与 Git
- [x] 6.3 创建原子 Commit 并关闭 Objective
