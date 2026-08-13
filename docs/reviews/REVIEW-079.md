# REVIEW-079：PLAN-015 统一知识投影 Change Review

## 审查对象

- Objective：`OBJ-010`
- Plan：[PLAN-015](../plans/PLAN-015.md)
- Spec：[SPEC-002](../specs/SPEC-002.md) `AC-KB-003`
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- 审查日期：2026-08-14

## 当前 Evidence

- 定向单元测试、typecheck、lint、production build 与 surface matrix 已通过。
- PostgreSQL + HTTP 隔离 smoke 已证明统一列表、跨来源分页、搜索、筛选、active 详情、pending 延续、Candidate/Public retrieval 与 private 即时撤回。
- 真实桌面与 390×844 浏览器已显示两个 Repository Wiki、只读多页详情和源码 Citation；Candidate Preview/Public Chat 已投影 Repository Citation。

## 发现

### FAIL：高页码会把无界候选集合拉入应用内存

`listKnowledge` 为合并 Knowledge Item 与 Repository Wiki，分别读取 `page × pageSize` 条记录后在 Node 中排序切片。`page` 当前最高允许 100000；即使最终只返回 100 行，也可能从两个来源读取并实例化数百万行，扩大数据库、网络和 Web 内存压力。该实现不满足统一分页的稳定性边界。

修复 owner：`src/server/knowledge/knowledge-service.ts`。统一行排序与 `LIMIT/OFFSET` 应下推到 PostgreSQL；回归测试必须证明大页码只扩大 OFFSET，不扩大返回候选 LIMIT。

### NOTE：跨语言词法召回仍受 Wiki 文本语言约束

公开 Chat 的英文问题能够从英文 Wiki 正确回答网格类型并投影 Citation；中文同义问题只召回概要段落并诚实返回证据不足。当前目标是接通 Approved Wiki 的浏览与问答来源，不包含跨语言语义检索，因此该限制不阻断本 Plan，但不能宣称已解决跨语言召回。

## 结论

`FAIL`

下一路由：Reconcile 统一分页查询与 active Projection 完整性边界，完成回归和全量门禁后重新 Change Review。
