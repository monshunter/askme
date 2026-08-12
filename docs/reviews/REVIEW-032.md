# REVIEW-032：PLAN-009 Plan Review

## 审查对象

- 制品：`PLAN-009`
- Revision：`HEAD 7ce39ec + PLAN-009 intake working tree`
- 上层 Objective：`OBJ-004`
- 上层合同：用户要求合并 Candidate Agent 预览与发布入口，删除重复语言切换、快捷操作、邀请面试及独立发布模块
- 审查日期：2026-08-12

## 发现

- Plan 从长期产品合同开始，再建立回归保护并收敛 Shell、Agent 页面和退役路由，最后更新稳定场景并执行真实验收，依赖顺序成立。
- 每个 Item 都表达可一次领取和验证的结果，没有把文件清单、实现步骤、Evidence 或额外状态写入 Plan。
- 范围明确保留 Platform Admin 治理、公共 Agent 权限和既有发布数据语义，避免把入口合并扩大为发布领域重写。
- 当前实现证明独立发布页与 Agent 页共享同一 publication service/API；因此只退役页面专用 UI、路由和恢复辅助边界，保留 Agent 页面继续使用的发布领域服务和接口。

## Spec/Design decision matrix

| Type | Boundary ID | Decision | Target | Reason |
|---|---|---|---|---|
| Spec | `askme-product-direction` | UPDATE | [根产品规格](../../SPEC.md) | Candidate MVP 与一级信息架构仍明确列出独立 Agent Preview 和 Publish Agent，需要与用户批准的新入口模型一致 |
| Spec | `askme-mvp-product` | UPDATE | [SPEC-001](../specs/SPEC-001.md) | Candidate Agent 命名、唯一导航入口、页面级语言入口和发布操作位置属于既有 MVP 外部行为 |
| Design | `askme-mvp-system` | UPDATE | [DESIGN-001](../architecture/DESIGN-001.md) | Candidate 路由拓扑与 publication service 的 consumer 边界需要从独立发布页收敛到 Agent 页面 |
| Design | `askme-ui-i18n-a11y` | UPDATE | [DESIGN-003](../architecture/DESIGN-003.md) | Candidate Shell 控件、Agent 页面信息架构和单一语言入口属于既有 UI/双语设计边界 |

## 结论

`PASS`

下一路由：按 Phase 1 更新并分别审查 `SPEC-001`、`DESIGN-001` 与 `DESIGN-003`，通过后再进入测试与实现。
