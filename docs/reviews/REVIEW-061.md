# REVIEW-061：PLAN-014 Repository Dossier 与 Runner 依赖调整 Plan Review

## 审查对象

- Objective：`OBJ-009`
- Plan：[PLAN-014](../plans/PLAN-014.md)
- Spec：[SPEC-002 §5、§8、AC-DOSSIER-001 至 AC-DOSSIER-003、AC-RUN-001 至 AC-RUN-003](../specs/SPEC-002.md)
- Design：[DESIGN-005 §5、§6、§8](../architecture/DESIGN-005.md)
- Revision：`PLAN-014 sha256:5c8b7be143403119f33870fc214433fad65bf7cf04a2ac564e5c56b48d01e323`
- 审查日期：2026-08-13

## 调整原因

当前实现证明确认了两个不同 owner：Phase 3 的 Dossier 域负责结构化输出、Artifact/Citation/coverage 的 Host 校验、append-only 持久化、Candidate Projection 与 active 治理；真实 Repository Analysis Run 的创建必须携带 Phase 4 才能锁定的 image digest、产品 Skill hash、prompt version 与 Code Agent Profile fingerprint，并由 runner lease/cleanup 生命周期执行。原 3.3 把“显式重跑”放在 runner 建立之前，无法形成真实可执行 Item。

## 原子性与顺序

- 3.1 现在只拥有 Generated Dossier 的 Host 校验与持久化，不再把尚未存在的 Pi/BoxLite producer 隐含在同一 Item；真实生成仍由 Phase 4 和 7 验收，没有缩小最终范围。
- 3.3 继续拥有批准时 active Revision/Projection 原子切换、旧 active 延续与 `analysis_outdated`，这些行为不依赖新 run 的创建入口。
- 新增 4.8 在 image、microVM、隔离、结果校验、调度、预算和 reconcile 已建立后，把首次分析与显式重跑接到真实 run；依赖顺序清楚，且一个 Item 只拥有 producer/queue 接线。
- Phase 7 的固定仓库、私有 Token、浏览器和全站回归不变，仍阻止用 fixture 或 mock 代替真实完成态。

## 覆盖与风险

- `SPEC-002` 的首次同步、visibility 提升、Candidate/Admin rerun 均由 4.8 覆盖；未删除任何用户授权行为。
- Host 输出校验与 runner 一次有界修正分别由 3.1 与 4.4 拥有：前者定义可持久化事实，后者拥有 guest 输出交互、预算、权限和修正生命周期，不重复状态 owner。
- Plan 仍是一份 Phase Checklist，没有加入执行日志、文件清单或 Evidence 台账。

## 结论

`PASS`

下一路由：按当前 Evidence 对账 Phase 3.1 至 3.3；随后进入 Phase 4.1 锁定并构建 Code Agent image。
