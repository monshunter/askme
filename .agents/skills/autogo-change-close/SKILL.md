---
name: autogo-change-close
description: "对账 Standard 的实际结果、Plan、进度、Journal 和 Commit；在实现与验证完成、准备提交或交付、进入 Waiting 或用户明确取消时使用；Fast 直接按根合同对账并交付，不调用本 Skill。"
---
# autogo-change-close
## 目标
核对正式 Plan 的 Phase Checklist 与当前实际结果；全部 Item 完成并通过必要验证后，在 Progress 勾选上层 Plan、汇总 Objective，再选择下一未完成 Plan 继续。
## 输入与发现
- Progress 中当前 Objective、Objective 状态和内嵌 Plans Checklist
- Phase Checklist、验收标准、Diff 和当前测试/运行结果
- Spec/Design/Plan/Review/Journal
- 剩余问题和范围外发现

## 输出与持久制品
- 当前 Plan 的 Phase Items 是否全部实际完成的准确结论
- 已汇总的 Objective 与已更新的 Progress、Journal、Index 和文档状态
- 有意义的 Commit（用户/项目策略允许时）
- 下一未完成 Plan，或 Completed、Cancelled、Waiting 的精确结论

## 副作用与 Human Gate
修改状态和文档，可创建 Commit；不得未经确认重写共享历史或对外发布。

## 执行步骤
1. 从 Progress 锁定当前 Plan，逐项核对 Phase Item、正式制品、实现、测试、环境和 Git
2. 确认所需 Change Review、E2E 或部署后验证已经通过；未验证项保持未勾选
3. 只有任务实际完成且 Evidence 成立时才勾选 Phase Item；其他过程信息不写入 Plan
4. 只有全部 Phase Items 完成，才在 Progress 将当前 Plan 勾选为 `[x]` 并重新汇总 Objective
5. 能安全隔离本 Plan 文件时创建一个单一工程意图的原子 Commit，避免混入无关改动
6. 当前 Objective 还有未完成 Plan 时立即选择下一项，执行 Plan Review 后继续；不得把单个 Plan 完成误报为 Objective 完成
7. 全部 Plan 完成后把 Objective 汇总为 `已完成`，判断是否需要 Journal、autogo-bug-report 或 autogo-session-review，并交付 Completed brief
8. Human Gate 或真实 Blocker 时不勾选当前 Plan，Objective 保持 `正在处理`；把等待原因、已完成准备和精确恢复条件写入产生等待的唯一事实 owner
9. 用户明确取消时先写 Journal，记录已有资产、未完成事实和清理状态，再从活动 Progress 移除 Objective；不删除 Plan、Commit 或其他事实制品

## 验证与完成
- 没有把未完成任务标记为完成
- 状态记录与 Git/测试/运行事实一致
- Phase Items 与实际完成情况一致，Objective 严格按 Progress 的 Plans Checklist 汇总
- Close 后已继续下一未完成 Plan，或进入准确的 Completed、Waiting、Cancelled 状态
- Commit 保持单一工程意图
- 范围外发现未被悄悄吞掉或扩张

## 失败、重试与幂等
验收不足返回对应 Implement/Review/E2E 进入 Reconcile；无法恢复一致状态时进入 `Waiting` 而非强行 Close。
- 重复执行前读取当前文件、Git 和运行状态；不重复创建已存在制品或重复执行已生效副作用。
- 相同失败再次出现时停止机械重试，回到 `autogo-investigate` 或上层设计。
- 状态和文档由 Agent 自动维护，不要求用户执行 Harness CRUD 命令。
