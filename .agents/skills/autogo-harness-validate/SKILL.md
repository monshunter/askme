---
name: autogo-harness-validate
description: "只读校验已安装 Native-Agent-First Harness 的治理区块、Skill 自包含结构、完整参考样例和 docs 工作区；在首次初始化、Harness 演进、安装更新后或宣布 Harness 结构完成前使用。"
---
# autogo-harness-validate

## 目标

对当前安装结果执行可重复的结构校验，报告错误和警告，不替代风险、产品、路由或完成判断。

## 输入与发现

- 项目根目录
- 当前 Agent 的 `.agents` 与 `AGENTS.md`
- 根/docs 治理区块、全部 Skill 目录、完整参考样例和 docs 工作区

## 输出与持久制品

- 错误、警告、代码和路径组成的校验报告
- 可选 JSON 报告

不创建或修改持久制品。

## 副作用与 Human Gate

全程只读，不需要 Human Gate。校验结果没有权限自动修改治理或宣布交付完成。

## 执行步骤

1. 确认正在校验正确项目根和当前 Agent 安装树。
2. 运行 Skill 自带脚本：

   ```bash
   python3 .agents/skills/autogo-harness-validate/scripts/validate_harness.py --root . --strict
   ```

   需要机器可读报告时增加 `--json`。
3. 根据错误代码回到对应 owner 修复；警告只有在 `--strict` 下阻止通过。
4. 修复后从同一项目根重新运行，直到当前范围内为 `0 errors, 0 warnings`。

## 验证与完成

- 根和 docs 托管区块存在
- 全部必需 Skill 符合命名、章节和自包含脚本结构
- 固定路径的完整参考样例与 Lifecycle Skill 接入点成立
- 标准 docs 工作区完整
- `--strict` 输出为 `0 errors, 0 warnings`

## 失败、重试与幂等

Python 不可用时由 Agent执行等价只读检查并明确证据边界。缺失结构不得降级为 PASS；同一文件状态重复校验必须得到同一错误和警告集合。
