---
name: autogo-session-review
description: "复盘会话中的决策、摩擦、失败恢复和 Harness 适配度；在复杂工作结束、重复失败、用户频繁介入、流程明显浪费，或用户要求复盘时使用。"
---
# autogo-session-review
## 目标
复盘当前工作会话的决策、摩擦、失败恢复和 Harness 适配度，形成候选改进而非即时膨胀规则。
## 输入与发现
- 本次目标、过程、Diff、工具调用、失败和 Evidence
- 相关 Bug Report、用户反馈和完成结果

## 输出与持久制品
- 有效做法、问题、根因候选和可复用经验
- Observation 或 Evolution Candidate
- 不需要提升为规则的局部经验说明

## 副作用与 Human Gate
修改复盘/演进文档；默认不修改项目指令、Skill 或工作流。

## 执行步骤
1. 比较计划路径与实际路径
2. 识别信息缺失、错误假设、无效重试和不必要用户介入
3. 区分项目问题、Skill 问题、工具问题和偶发问题
4. 优先提出删除、合并或自动化，而非新增规则
5. 单次普通问题只记录 Observation
6. 更新 evolution 工作区索引

## 验证与完成
- 建议由真实 Evidence 支撑
- 明确收益、成本、风险和适用范围
- 没有因一次偶发问题修改根治理

## 失败、重试与幂等
证据不足时保留 Observation，不升级 Proposal。
- 重复执行前读取当前文件、Git 和运行状态；不重复创建已存在制品或重复执行已生效副作用。
- 相同失败再次出现时停止机械重试，回到 `autogo-investigate` 或上层设计。
- 状态和文档由 Agent 自动维护，不要求用户执行 Harness CRUD 命令。
