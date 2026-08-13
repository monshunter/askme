# REVIEW-059：PLAN-014 Askme 全站回归范围调整 Plan Review

## 审查对象

- Objective：`OBJ-009`
- Plan：[PLAN-014](../plans/PLAN-014.md)
- 前次审查：[REVIEW-058](REVIEW-058.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- 新增授权：端到端回归验证 Askme 的所有页面、功能、API 与场景用例
- Revision：`PLAN-014 sha256:b848934a2cf8554391e5b323aca9cf78520ea6d76eb2bb6c085d6685febbdd8e`
- 审查日期：2026-08-13

## 范围调整与 owner

- Objective 与 Plan 已明确把 Askme 全站回归纳入完成条件；范围仅覆盖当前 Askme 仓库和运行环境，不扩展到仓库外产品。
- surface owner 明确为当前 `src/app` 页面与 Route Handler、`package.json` 的 smoke/E2E 入口、正式 Scenario 和可见用户功能；实现结束时必须从当前 revision 重新生成矩阵，不能依赖开工时的静态清单。
- `SPEC-002` 18 条 AC 仍拥有 Repository V1 行为验收；全站回归验证既有 `SPEC-001` 行为没有回归，但不无痕改写历史 AC 或把历史 Evidence 视为当前 PASS。

## 原子性与顺序

- Phase 1 至 Phase 6 的实现顺序不变，已完成 Item 的当前 Evidence 仍与新增范围一致；新增范围不会使 Repository sync/Artifact 工作失去价值。
- Phase 7 先完成组件与固定仓库验收，再建立最终 surface matrix，随后分别领取页面、API、package smoke/Scenario、全功能浏览器旅程和保留数据部署，避免一个笼统“全站测试”Item 同时拥有多个失败 owner。
- 页面回归包含匿名/Candidate/Public/Admin、桌面/移动、导航和错误态；API 回归包含 method、身份、权限、成功、失败、幂等与即时撤权；浏览器旅程独立检查 console、network、可访问性和横向溢出。
- 退役路由、恢复场景和失败语义被显式纳入，不能只验证 happy path。

## 覆盖与风险

- Askme 当前只有 `SCN-001`，无法单独证明 Admin、邀请、资料/知识完整生命周期或 Repository/runner/SSE；Plan 要求运行全部现有入口并按新功能创建必要的 Repository Scenario。
- “全部功能”以可枚举的页面交互、API consumer/producer 和正式场景为准；surface matrix 中任何缺失、未执行或无可信 Evidence 的条目都会阻止 7.12 和 Objective 完成。
- 真实 BoxLite、私有 GitHub Token、AI endpoint 与宿主部署仍需当前 Evidence；mock、设计文档或历史 PASS 不能替代端到端结果。

## 结论

`PASS`

下一路由：恢复 Phase 2.2，完成 Artifact 实现和定向验证后继续当前 Plan；Phase 7 按最终 revision 执行 Askme 全站回归。
