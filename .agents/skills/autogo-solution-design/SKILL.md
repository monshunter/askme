---
name: autogo-solution-design
description: "设计满足 Spec 的最小系统方案，覆盖组件、契约、状态、失败和回滚；在从零建设、跨组件、公共契约、持久状态、新基础设施，或现有架构无法支撑已批准 Spec 时使用。"
---
# autogo-solution-design
## 目标
将已批准行为规范转化为最小充分的系统组织方案，覆盖组件、契约、状态、失败、运维和回滚。
## 输入与发现
- Progress 中当前 Objective 和 Plan；已批准或足够稳定的 Spec 从正式制品读取
- 现有系统架构、代码边界、运行约束和生态能力
- 风险、成本、安全、兼容性和迁移要求
- 当前 Plan Review 中所有 Design `CREATE | UPDATE | REFERENCE | NOT_NEEDED` 决策行

## 输出与持久制品
- Solution Design 与必要 ADR
- 系统上下文、组件职责、依赖方向、接口、数据和状态模型
- 失败恢复、安全、可观测、迁移、部署和回滚方案
- 关键权衡、假设和待验证风险
- 已写入 Design/ADR 和索引的风险与下一步

## 副作用与 Human Gate
修改设计文档；不得直接实施生产副作用。

## 执行步骤
1. 从 Progress 确认当前上层 Plan，再从正式制品锁定设计范围，不为范围外工作扩张设计
2. 读取 Design 决策行；`NOT_NEEDED` 不创建、修改或引用 Design，`REFERENCE` 只建立引用且不修改 Target，只有 `CREATE/UPDATE` 继续写入
3. `CREATE` 新建已审查的独立架构边界；`UPDATE` 修改既有 active owner或收编无身份旧文档，写入稳定 `Boundary ID`、`Owner boundary` 和 `Status`
4. 从目标、已批准 Spec、边界和系统不变量开始
5. 盘点项目已有能力和成熟生态，避免重复建设
6. 设计能力和流程，再落到组件职责和契约
7. 明确状态、并发、一致性、失败、恢复和观测
8. 定义迁移、兼容、部署和回滚
9. 只对关键不可逆取舍创建 ADR
10. 更新 Design/ADR 和索引，再进入 autogo-design-review；不把设计阶段或细节写入 Progress

## 验证与完成
- 每个组件有单一清晰职责
- 没有双重事实源和循环依赖
- 方案满足 Spec 且复杂度最小充分
- 关键风险有验证和回滚路径
- 设计范围与当前 Objective/Plan 及正式制品一致
- 同一个 `Boundary ID` 最多一份 active Design，Plan 不成为长期 Design owner

## 失败、重试与幂等
关键事实未知时回 autogo-investigate；关键产品语义未批准时回 autogo-spec-write。
- 重复执行前读取当前文件、Git 和运行状态；不重复创建已存在制品或重复执行已生效副作用。
- 相同失败再次出现时停止机械重试，回到 `autogo-investigate` 或上层设计。
- 状态和文档由 Agent 自动维护，不要求用户执行 Harness CRUD 命令。
