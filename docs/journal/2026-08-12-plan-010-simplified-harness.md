# 2026-08-12：OBJ-005 简化 Harness 迁移收口

记录类型：requested

Objective：`OBJ-005` 验收并收口 AutoGo 简化 Harness 安装与任务能力边界在 Askme 的迁移

Plan：[PLAN-010](../plans/PLAN-010.md)

Review：[REVIEW-043](../reviews/REVIEW-043.md)、[REVIEW-044](../reviews/REVIEW-044.md)

## 已完成事实

- 将 Askme 的 Harness 投影对账到 AutoGo 当前简化安装与任务能力边界：manifest 使用 schema 3，固定元流程制品改为按任务价值调用，Harness 自检与 delivery trace 发行能力退休。
- 保留 Askme 根合同中的项目概述，并确认其后的治理正文及两个 docs 托管区块与当前 AutoGo 渲染资源一致。
- 发现 Askme 本地 `test_validate_delivery_trace.py` 仍依赖已删除主脚本后，将该残留 consumer 纳入同一迁移范围清理。
- 建立 `OBJ-005` / `PLAN-010`，如实记录安装投影早于本地 Plan 已存在，并完成 Plan Review 与 Change Review。

## 验证摘要

- 42 个管理文件：0 missing、0 mismatch；2 个 docs 托管区块全部匹配。
- AutoGo 当前源的 `resources/install/cli` 定向测试与 `make acceptance` 通过。
- Askme 当前为 24 个 Skills、3 个可编译 Python 脚本；已退休目录、主脚本和残留测试均不存在。
- Plans/Reviews Index 重建幂等，当前 `git diff --check` 通过。

## 未完成事实与风险

- 尚需由 `autogo-change-close` 完成 Plan、Progress、暂存范围和原子 Commit 对账。
- AutoGo 根合同的“系统思维最小应用”增量在源工作树中尚未提交；本次只对账并提交 Askme 当前投影，不修改或代替 AutoGo 源项目收口。
- schema 3 后续重装会覆盖根 `AGENTS.md`；Askme 项目概述需要再按当时仓库事实初始化。
- 本次未运行 Askme 产品测试、浏览器 E2E 或部署验证，因为当前 Diff 不修改产品实现或运行环境。

## 下一恢复点

在 `opt/harness-simplified-install-sync` 分支读取本 Journal、`PLAN-010`、`REVIEW-044` 和当前 Git Diff，重跑本地结构与 Diff 检查后完成关闭提交。

## 预期 Commit subject

`refactor(harness): sync simplified install boundaries`

Journal 不回填 Commit hash；实际关联由 Git 历史查询。
