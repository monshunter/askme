---
name: autogo-change-close
description: "在 Change Review、Session Review 和 Journal 完成后，对账 Standard 的实际结果、Plan、Progress 与 Commit 前 trace；准备提交或交付时使用；Fast 直接按根合同对账并交付，不调用本 Skill，Waiting/Cancelled 的记录先由 autogo-work-journal 完成。"
---
# autogo-change-close
## 目标
核对正式 Plan 的 Phase Checklist 与当前实际结果；全部 Item 完成并通过必要验证后，在 Progress 勾选上层 Plan、汇总 Objective，再选择下一未完成 Plan 继续。
## 输入与发现
- Progress 中当前 Objective、Objective 状态和内嵌 Plans Checklist
- Phase Checklist、验收标准、Diff 和当前测试/运行结果
- Plan Review 的 `Spec/Design decision matrix`、Target 和理由
- Spec/Design/Plan/Review/Scenario/Journal/Evolution
- autogo-session-review 的四态结果和 autogo-work-journal 的当前记录
- 剩余问题和范围外发现

## 输出与持久制品
- 当前 Plan 的 Phase Items 是否全部实际完成的准确结论
- 已汇总的 Objective、Progress 和文档状态；Journal/Index 已由其 owner 在进入本 Skill 前更新
- 有意义的 Commit（用户/项目策略允许时）
- 下一未完成 Plan，或 Completed、Cancelled、Waiting 的精确结论

## 副作用与 Human Gate
修改状态和文档，可创建 Commit；不得未经确认重写共享历史或对外发布。

## 执行步骤
1. 从 Progress 锁定当前 Plan，逐项核对 Phase Item、正式制品、实现、测试、环境和 Git
2. 确认所需 Change Review、E2E 或部署后验证已经通过；未验证项保持未勾选，Review 普通失败返回对应 owner Reconcile
3. 确认 autogo-session-review 已给出 `NO_EVOLUTION` 或唯一 `EVO-*` 结果，且 autogo-work-journal 已在 Commit 前写入当前 `delivery` 记录并同步 Index
4. 运行 Skill 自带只读脚本的 strict close 检查：`python3 .agents/skills/autogo-change-close/scripts/validate_delivery_trace.py --root . --mode strict --plan <PLAN_PATH>`；它校验决策矩阵、Target、稳定身份、Git 基线、Diff、同类型 active 唯一性和 superseded 替代链；历史回放使用 `--mode audit`，warning 不伪造历史制品
5. trace FAIL 返回 Spec/Design、Plan Review、Scenario、Session Review、Journal 或 Index 的真实 owner 修复，不绕过校验继续 Commit
6. 只有任务实际完成且 Evidence 成立时才勾选 Phase Item；其他过程信息不写入 Plan
7. 只有全部 Phase Items 完成，才在 Progress 将当前 Plan 勾选为 `[x]` 并重新汇总 Objective
8. 能安全隔离本 Plan 文件时创建一个单一工程意图的原子 Commit，避免混入无关改动；Journal 不回填 Commit hash
9. 当前 Objective 还有未完成 Plan 时立即选择下一项，执行 Plan Review 后继续；不得把单个 Plan 完成误报为 Objective 完成
10. 全部 Plan 完成后把 Objective 汇总为 `已完成`并交付 Completed brief；Bug Report 仍按其独立触发条件路由
11. Human Gate 或真实 Blocker 时不勾选当前 Plan，Objective 保持 `正在处理`；先由 autogo-work-journal 写入 `handoff`，再把等待原因、已完成准备和精确恢复条件写入产生等待的唯一事实 owner
12. 用户明确取消时先由 autogo-work-journal 写入 `cancel`，记录已有资产、未完成事实和清理状态，再从活动 Progress 移除 Objective；不删除 Plan、Commit 或其他事实制品

## 验证与完成
- bundled delivery trace 回归通过：`PYTHONDONTWRITEBYTECODE=1 python3 .agents/skills/autogo-change-close/scripts/test_validate_delivery_trace.py`
- 没有把未完成任务标记为完成
- 状态记录与 Git/测试/运行事实一致
- Phase Items 与实际完成情况一致，Objective 严格按 Progress 的 Plans Checklist 汇总
- Close 后已继续下一未完成 Plan，或进入准确的 Completed、Waiting、Cancelled 状态
- Commit 保持单一工程意图
- strict delivery trace 对四态矩阵与 Diff 为 `0 errors`；历史 audit warning 没有被回填成伪造历史
- 范围外发现未被悄悄吞掉或扩张

## 失败、重试与幂等
验收不足返回对应 Implement/Review/E2E 进入 Reconcile；无法恢复一致状态时进入 `Waiting` 而非强行 Close。
- 重复执行前读取当前文件、Git 和运行状态；不重复创建已存在制品或重复执行已生效副作用。
- 相同失败再次出现时停止机械重试，回到 `autogo-investigate` 或上层设计。
- 状态和文档由 Agent 自动维护，不要求用户执行 Harness CRUD 命令。
