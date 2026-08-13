# PLAN-014：交付代码仓库 Wiki 与深度分析 V1

## 目标

实现并验收 `SPEC-002` 定义的 Repository 同步、由 Pi 在 sandbox 生成并由 Host copy-out 的单页或多页 Repository Wiki Markdown、问答路由、隔离分析、权限投影、异步反馈、成本治理与固定仓库真实场景，使 Candidate 获得可用于系统理解仓库的完整 Wiki，而不是离散 Claim 卡片；同时端到端回归当前应用全部页面、用户功能、Route Handler API 与正式场景，任何未覆盖 surface 都不视为闭环。

## 范围

本 Plan 修改应用代码、数据库 migration、配置、依赖、产品 Skill、runner、容器与宿主运行入口、Candidate/Public/Admin UI、测试和必要验收场景；移除已被替代的 GitHub Source Material 与 DeepSeek 专用边界。范围严格遵守 [SPEC-002](../specs/SPEC-002.md) 的 V1 非目标，并按 [DESIGN-005](../architecture/DESIGN-005.md) 的单 Repository、不可变 Revision、Approved Wiki 唯一持久语义索引、无源码 RAG、每 run 新 microVM 与 Host 确定性授权不变量实施。全站回归以当前 `src/app` 页面与 Route Handler、`package.json` 的 smoke/E2E 入口、正式 Scenario 和可见用户功能为 surface 基线，不把单元测试、历史 Evidence 或少量 happy-path smoke 当作端到端全覆盖。

## Phase 1：建立通用 AI 与 Repository 领域基座

- [x] 1.1 交付可独立配置的 Router、RAG Answer 与 Code Agent Profile，并保持既有文档问答回归成立
- [x] 1.2 建立 Repository、Revision、Artifact、Projection、Analysis Run 与源码 Citation 的领域基座
- [x] 1.3 从文档型 Material 中移除 GitHub consumer，并完成新旧领域边界的 migration 验证

相关合同：[SPEC-002 §4、§5、§9、AC-REPO-001、AC-AI-002](../specs/SPEC-002.md)

## Phase 2：交付安全同步与不可变 Artifact

- [x] 2.1 交付 GitHub.com 公开与私有 Repository 的请求内同步、完整 SHA 固定和失败保留旧 active 行为
- [x] 2.2 交付 archive 安全过滤、容量限制与不可变 Artifact
- [x] 2.3 交付 Artifact 引用保留与精确 GC
- [x] 2.4 交付 Candidate Repository 同步、重新同步、visibility 与状态反馈体验

相关合同：[SPEC-002 §4、AC-REPO-001、AC-REPO-002、AC-REPO-003](../specs/SPEC-002.md)

## Phase 3：交付 Repository Wiki Markdown 审核闭环

- [x] 3.1 交付单页/多页 Generated Wiki、导航 manifest、结构化 Citation、诚实 coverage 与 Host 校验持久化
- [x] 3.2 交付 Candidate 导航树、逐页 Markdown 阅读、编辑、预览和批准的 Approved Projection
- [x] 3.3 交付 Claim-only legacy 退出、active 原子切换、旧合格 active 延续和 `analysis_outdated` 治理行为

相关合同：[SPEC-002 §5、AC-WIKI-001、AC-WIKI-002、AC-WIKI-003](../specs/SPEC-002.md)

## Phase 4：交付隔离 Code Agent Runner

- [x] 4.1 更新并锁定带受限 `write_wiki`、能按内容生成单页/多页 Wiki 的 Askme 产品 Skill 与 Code Agent image
- [x] 4.2 交付每 run 新 BoxLite microVM 的创建、bootstrap、Artifact 复制与确定性清理生命周期
- [x] 4.3 交付 guest 网络、凭证、工具和 Repository 指令隔离合同
- [x] 4.4 交付 sandbox Wiki copy-out、文件/Markdown/Citation/权限/预算 Host 校验及一次有界修正
- [x] 4.5 交付实时优先级调度、并发预留与数据库 lease
- [x] 4.6 交付服务端配额、运行预算与 watchdog
- [x] 4.7 交付取消、安全失败与 lease/cleanup reconcile 行为
- [x] 4.8 将同步、visibility 提升与 Candidate/Admin 显式重跑接入真实 Repository Analysis Run

相关合同：[SPEC-002 §8、§10、§11、AC-RUN-001、AC-RUN-002、AC-RUN-003、AC-COST-001](../specs/SPEC-002.md)

## Phase 5：接通问答路由、历史消息与权限投影

- [x] 5.1 将 Approved Wiki section 与已索引上传资料接入同一统一 EvidenceProvider，并保持确定性门禁与 `rag/deep/refuse` Router
- [x] 5.2 交付 Candidate/Public 异步深度问答及 answered、insufficient、refused、failed、cancelled 反馈
- [x] 5.3 交付单 Repository 消歧、消息幂等、最小历史持久化与深度结论不回写约束
- [x] 5.4 交付四级 Repository visibility、历史 Citation 重投影与不可变源码预览

相关合同：[SPEC-002 §6、§7、AC-ROUTE-001、AC-ROUTE-002、AC-ROUTE-003、AC-PRIV-004、AC-HISTORY-001](../specs/SPEC-002.md)

## Phase 6：交付异步事件、治理与运行反馈

- [x] 6.1 交付基于数据库 snapshot/version 的 SSE、重连、授权失效与终态资源获取
- [x] 6.2 交付 Candidate 公开深度分析开关与多层配额的确定性管理能力
- [x] 6.3 交付 Admin 禁用、重跑、取消、健康、usage 与安全错误治理能力
- [x] 6.4 交付 Web、worker、runner、Artifact Store 与 BoxLite 的 readiness 和安全观测

相关合同：[SPEC-002 §8、§10、AC-ASYNC-001、AC-COST-001](../specs/SPEC-002.md)

## Phase 7：完成固定输入与真实运行验收

- [x] 7.1 完成单元与 PostgreSQL 集成验证
- [x] 7.2 完成 AI SDK 与 guest image 合同验证
- [x] 7.3 完成 runner 与 SSE 故障恢复验证
- [x] 7.4 以固定 public Revision 完成内容驱动的单页/多页 Wiki bundle 和约 10 题路由、事实、Citation 基准验收
- [x] 7.5 以固定 private Revision 完成一次性 Token、不可变 SHA、撤权、清理和泄露扫描验收
- [x] 7.6 建立并核对当前全部页面、用户功能、API method 与 Scenario 的端到端 surface matrix
- [x] 7.7 逐项回归匿名、Candidate、Public 与 Admin 的全部页面及桌面/移动端布局、导航和错误态
- [x] 7.8 逐项回归全部 Route Handler 的身份、权限、成功、失败、幂等与即时撤权行为
- [x] 7.9 运行并核对全部 package smoke/E2E 入口与正式 Scenario，不跳过退役路由和恢复场景
- [x] 7.10 完成 Candidate/Public/Admin 全功能真实浏览器旅程，并检查 console、network、可访问性与横向溢出
- [x] 7.11 在保留现有数据的前提下部署并验证 Web、worker、runner、数据库、Artifact 与核心恢复路径
- [x] 7.12 完成全部 18 条 AC、全站 surface matrix、Diff、Review、Plan、Progress、Git 与未验证项对账收口

相关合同：[SPEC-002 §12、§13、AC-ACCEPT-001](../specs/SPEC-002.md)
