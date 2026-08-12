# PLAN-010：对账简化 Harness 迁移并完成交付收口

## 目标

以 AutoGo 已完成的 Harness 安装与任务能力简化为源头事实，验收其在 Askme 的安装投影，确认当前项目规则、资源清单和退休能力保持一致，并完成可恢复的原子收口。

## 范围

本 Plan 只对账 AutoGo 管理的根合同、Skills、模板、manifest 与 docs 托管区块，以及本次用户要求的 Journal、Review、Progress 和 Git 收口；不修改 Askme 产品代码、产品行为、数据库、运行环境，也不修改 AutoGo 源项目。

## Phase 1：锁定迁移边界

- [x] 1.1 对照 AutoGo 当前来源与 Askme 完整 Diff 确认单一迁移范围
- [x] 1.2 确认退休 Harness 自检与 delivery trace 后不存在残留 consumer

## Phase 2：验证项目投影

- [x] 2.1 验证 manifest、管理路径、根合同与 docs 托管区块的一致性
- [x] 2.2 验证 Skill、模板、索引和 Git Diff 的结构与幂等性

## Phase 3：审查与收口

- [x] 3.1 完成当前迁移 Diff、兼容边界和验证结果的 Change Review
- [x] 3.2 完成用户要求的 Journal 与文档索引对账
- [x] 3.3 完成 Plan、Progress 与 Git 提交范围对账
