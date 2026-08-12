---
name: autogo-session-review
description: "复盘 Standard 交付中的决策、摩擦、失败恢复和 Harness 适配度；在每个 Standard Plan Commit 前使用，复杂工作、重复失败、用户频繁介入、流程明显浪费或用户要求复盘时加深分析；Fast 默认不调用。"
---
# autogo-session-review
## 目标
复盘当前工作会话的决策、摩擦、失败恢复和 Harness 适配度，形成候选改进而非即时膨胀规则。
## 输入与发现
- Progress 中当前 Objective、Plan 与即将关闭的 Standard 交付边界
- 本次目标、过程、Diff、工具调用、失败和 Evidence
- 相关 Bug Report、用户反馈和完成结果

## 输出与持久制品
- 有效做法、问题、根因候选和可复用经验
- 固定四态结果：`NO_EVOLUTION | OBSERVATION | CANDIDATE | PROPOSAL`
- `OBSERVATION/CANDIDATE/PROPOSAL` 对应的 `EVO-*` 文档与 Index；`NO_EVOLUTION` 只进入本次 Journal

## 副作用与 Human Gate
修改复盘/演进文档；默认不修改项目指令、Skill 或工作流。

## 执行步骤
1. 比较计划路径与实际路径
2. 识别信息缺失、错误假设、无效重试和不必要用户介入
3. 区分项目问题、Skill 问题、工具问题和偶发问题
4. 如果发现产品、测试、恢复或交付缺陷，返回对应 owner Reconcile，不得继续 Journal 或 Commit
5. 优先提出删除、合并或自动化，而非新增规则
6. 无可复用 Harness 改进时输出 `NO_EVOLUTION`，不创建 Evolution 文档
7. 单次可复用问题输出 `OBSERVATION`；重复候选输出 `CANDIDATE`；具备证据、复杂度预算、验证和回滚时输出 `PROPOSAL`
8. 只有 `OBSERVATION/CANDIDATE/PROPOSAL` 创建或更新唯一 `EVO-*` 并同步 evolution Index，然后把结果交给 autogo-work-journal

## 验证与完成
- 建议由真实 Evidence 支撑
- 明确收益、成本、风险和适用范围
- 没有因一次偶发问题修改根治理
- 每个 Standard Commit 前都有且只有一个四态结果；`NO_EVOLUTION` 不制造空 Evolution 文档

## 失败、重试与幂等
证据不足时保留 Observation，不升级 Proposal。
- 重复执行前读取当前文件、Git 和运行状态；不重复创建已存在制品或重复执行已生效副作用。
- 相同失败再次出现时停止机械重试，回到 `autogo-investigate` 或上层设计。
- 状态和文档由 Agent 自动维护，不要求用户执行 Harness CRUD 命令。
