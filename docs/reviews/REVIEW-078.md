# REVIEW-078：DESIGN-005 统一知识只读投影 Design Review

## 审查对象

- Objective：`OBJ-010`
- Plan：[PLAN-015](../plans/PLAN-015.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- Revision：`DESIGN-005 sha256:6842202b003f85fa98ff6a0bb1446a34a29184ead5163ec7c6f91998915b4a62`
- 审查日期：2026-08-14

## 边界与复杂度

- `UnifiedKnowledgeReadModel` 只投影现有事实，不新增持久表、复制 Wiki Markdown、创建第二 section index 或改变 Repository approval 事务，复杂度与个人知识库规模匹配。
- `sourceKind` 显式保持 Knowledge Item 与 Repository Wiki 的领域身份；Knowledge Item 编辑和 Repository Wiki 只读详情没有共享错误写入口。
- active Repository 详情从 `active_projection_id` 出发，明确不复用最新待审核 Dossier，能够在重分析期间继续返回旧 active Wiki。

## 状态、失败与兼容

- owner、status、type、search、citation readiness、visibility 与 active pointer 在服务端统一约束，浏览器不拼接两个不一致总数。
- 无数据库 migration；旧 Knowledge Item API 行为通过 discriminator 扩展，回滚应用即可恢复旧读模型，现有 Repository/Material 数据不需要转换。
- 实现仍需用分页排序、未审核隔离、active 切换和 Candidate/Public 问答测试证明这些设计约束，已由 PLAN-015 Phase 2/3 覆盖。

## 结论

`PASS`

下一路由：进入测试驱动实现统一知识列表与 Repository Wiki 详情。
