---
name: autogo-e2e-run
description: "运行真实用户或系统端到端场景并收集 Evidence；在核心或跨组件链路、浏览器交互、单元与集成测试不足，或部署前后需要 Smoke/E2E 时使用。"
---
# autogo-e2e-run
## 目标
按真实用户或系统场景运行端到端验证，收集 Evidence，并对失败完成调查—修复—重验闭环。
## 输入与发现
- 验收场景、目标环境、测试数据和环境入口
- Progress 中当前 Objective 和 Plan；待验证 AC 和 Phase Items 从正式制品读取
- 相关 Spec、Plan、风险与恢复要求

## 输出与持久制品
- 场景级 PASS/FAIL/BLOCKED 结果
- 命令、日志、截图/录像引用和关键观察
- 失败根因候选、清理结果和下一路由
- 仅在场景通过后更新的 Spec AC、Phase Item 和对应 Evidence

## 副作用与 Human Gate
可操作已授权测试环境和浏览器；生产环境、破坏性清理、权限、Secret 或不可逆操作必须满足对应 Human Gate。

## 执行步骤
1. 从 Progress 确认当前上层 Plan，再从正式 Plan/Spec 读取待验证 AC 和 Phase Items
2. 选择最小但覆盖核心风险的场景
3. 通过 autogo-env-manage 准备隔离环境和测试数据
4. 确认起始状态，运行场景并记录时间/版本/输入
5. 验证用户可见结果和后台状态
6. PASS 后才勾选对应 Phase Items 并按 Spec 规则更新 AC；FAIL/BLOCKED 保持未完成并记录 Evidence
7. 失败时保留 Evidence，转 autogo-investigate，不盲目重复
8. 测试结束清理临时资源，更新 Scenario、正式制品和 Index；不把场景细节写入 Progress

## 验证与完成
- 场景可复现且与验收标准对应
- Evidence 足以区分应用失败和环境失败
- 未使用伪造截图或仅凭 UI 表象宣称通过
- Spec AC、Phase Items 与场景结果一致；Progress 只在整个上层 Plan 完成后勾选对应项

## 失败、重试与幂等
环境不可信时 BLOCKED；失败转 autogo-investigate/implement 后必须重新运行。
- 重复执行前读取当前文件、Git 和运行状态；不重复创建已存在制品或重复执行已生效副作用。
- 相同失败再次出现时停止机械重试，回到 `autogo-investigate` 或上层设计。
- 状态和文档由 Agent 自动维护，不要求用户执行 Harness CRUD 命令。
