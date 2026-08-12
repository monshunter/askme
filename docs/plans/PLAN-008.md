# PLAN-008：对账 EVO-001 迁移实现并完成交付收口

## 目标

以 AutoGo 已实施的 Harness 演进为源头事实，验收 Askme 中 `EVO-001` 的迁移结果，修复迁移投影遗漏，并按新的 Standard 关闭合同完成可恢复收口。

## 范围

本 Plan 只对账当前 Harness 规则、Skills、模板、manifest、validator、docs 投影与 `EVO-001` 状态；不修改产品代码、产品行为、数据库、运行环境或已完成 Objective 的历史结论。

## Phase 1：恢复与对账

- [x] 1.1 对照 AutoGo 已实施版本确认 Askme 迁移范围与差异
- [x] 1.2 使 `EVO-001` 状态与用户确认的已实施事实一致

## Phase 2：迁移验收

- [x] 2.1 修复安装投影中与 AutoGo 源实现不一致的 Harness 内容
- [x] 2.2 完成 Harness 结构、确定性关闭检查与幂等索引验证

## Phase 3：审查与收口

- [x] 3.1 完成当前迁移 Diff、兼容边界和验证结果的 Change Review
- [x] 3.2 完成 Session Review、Journal、Index 与提交前恢复上下文对账
