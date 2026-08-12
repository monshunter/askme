---
name: autogo-plan-review
description: "只读审查 Plan 的 Phase 与 Item 是否简单、有序、原子且覆盖目标；在正式 Plan 新建或实质调整后、进入执行前，或执行中发现粒度不合适时使用。"
---
# autogo-plan-review
## 目标
只读审查正式 Plan 是否是一份简单、可执行的 Phase Checklist，并为每个受影响边界锁定长期 Spec/Design owner 决策。
## 输入与发现
- Progress 中当前 Objective 和 Plan
- Plan、相关 Spec/Design、当前代码事实和批准范围

## 输出与持久制品
- PASS / PASS_WITH_NOTES / FAIL / BLOCKED，以及 `Type | Boundary ID | Decision | Target | Reason` 决策矩阵
- 缺失任务、错误顺序、粒度过大或实现细节化等发现
- 修订建议、下一路由和 Review 记录

## 副作用与 Human Gate
默认只读被审 Plan；只可写 Review 记录。

## 执行步骤
1. 检查 Plan 是否只有一份文档，并以目标、范围和有序 Phase Checklist 为主体
2. 检查每个 Phase 是否只表达一个边界清楚的小目标
3. 检查每个 Item 是否可以一次领取、执行和勾选，且没有把实现步骤、文件清单或验证日志当作任务
4. 检查 Phase 顺序是否合理，是否覆盖当前批准目标且没有范围扩张
5. 读取 Intake 候选，按 `Boundary ID`、Index、现有链接、代码/测试事实、superseded 链和无身份旧文档确认唯一长期 owner；多候选时先 Investigation，不创建第三份
6. 对每个 `artifact type × Boundary ID` 记录一行 `CREATE | UPDATE | REFERENCE | NOT_NEEDED`；Spec 与 Design 正交判断，某类完全不需要时使用一行类型级 `NOT_NEEDED`
7. 默认使用 `UPDATE`；只有新的独立用户结果、系统职责、生命周期或替代关系有当前 Evidence 时才用 `CREATE`，新 Objective、Plan、文件编号或篇幅不能单独举证
8. `UPDATE/REFERENCE` 指向正确的现有 owner；无稳定身份的旧文档首次收编必须 `UPDATE`，完成前不能 `REFERENCE`；`NOT_NEEDED` 写明具体理由
9. 检查相关 Spec/Design/AC 链接是否放在对应 Phase，且没有复制正文或状态表；能够独立验证、提交或延期的多个边界必须拆 Plan
10. 检查 Plan 是否引入独立 Checklist、执行过程、验证记录或额外状态字段
11. 只记录发现，不隐式修改 Plan；将 Verdict、决策矩阵和下一阶段写入 Review 制品
12. `PASS` 或可继续的 `PASS_WITH_NOTES` 才允许执行第一条 Item；目标、范围、Phase、顺序、验收覆盖、矩阵行、Decision 或 Target 实质调整后必须重新审查

## 验证与完成
- 另一 Agent 可以直接从下一条未勾选 Item 继续工作
- Phase 与 Item 的粒度小而清楚，没有笼统阶段或微观实现步骤
- 所有 Item 都服务于 Plan 目标，且没有重复状态 owner
- Review PASS 不代表 Checklist 已执行，也不更新 Progress
- Review 中每个受影响边界和类型只有一行决策；Target、理由和 active owner 可由关闭校验机械验证

## 失败、重试与幂等
Plan 问题返回 autogo-plan-write 并在修订后重新审查；上层目标、设计或规范问题返回对应 Skill。`FAIL` 不关闭 Plan，也不触发普通回滚。
- 重复审查前读取当前 Plan，结论只针对当前内容。
- 状态和文档由 Agent 自动维护，不要求用户执行 Harness CRUD 命令。
