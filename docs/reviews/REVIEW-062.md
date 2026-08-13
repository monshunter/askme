# REVIEW-062：PLAN-014 Phase 3 Repository Dossier 增量 Change Review

## 审查对象

- Objective：`OBJ-009`
- Plan：[PLAN-014 Phase 3](../plans/PLAN-014.md)
- Plan Review：[REVIEW-061](REVIEW-061.md)
- Spec：[SPEC-002 §5、§7、AC-DOSSIER-001 至 AC-DOSSIER-003](../specs/SPEC-002.md)
- Design：[DESIGN-005 §5.2、§6、§9](../architecture/DESIGN-005.md)
- 审查日期：2026-08-13

## Findings

无剩余阻塞 correctness、安全、兼容或范围发现。

审查中发现并已 Reconcile 两项状态缺陷：

1. provenance 漂移最初只按 active Revision 匹配，会把同 Revision 的历史 Generated Version 也计入 active outdated；现已通过 `active_projection_id → projection.dossier_id` 精确定位当前 active Dossier。
2. active Dossier 上创建新 draft Projection 后，GET 曾把当前编辑 draft 与 `active_projection_id` 直接比较，误报 `isActive=false`；现已独立解析 active Projection 所属 Dossier，新 draft 编辑期间旧 approved Projection 继续显示 active。

## 正确性与安全边界

- Agent 输出先受 1 MiB JSON/Zod schema、claim/category/visibility、coverage 自洽约束，再按 immutable manifest 读取实际 examined path；每条事实 claim 必须有当前 Revision Citation，path、1 至 200 lines 与规范化片段 hash 均由 Host 重算。
- Artifact reader 重新校验 `.tar.zst` checksum、manifest checksum、content key、repository、SHA、filter fingerprint、file count 与单文件 content hash；未知 path、损坏 manifest、非 UTF-8 或篡改内容均拒绝。
- Generated Dossier、claims 与 Citations 只由 run 完成事务追加；run 必须是有效 `repository_analysis` lease、未取消、Repository 未禁用且 Revision `stored`。Dossier/run event/audit 与 completed run 原子提交，重复完成复用同一 Dossier。
- Candidate API 只能引用已有 claim，不能创建 claim 或修改 Citation；可改展示措辞、隐藏或降低 visibility，不能高于 generated claim 或当前 Repository visibility。
- 批准前重新读取 Artifact 验证所有事实 Citation；approved Projection、旧 Projection supersede 与 Repository `active_revision_id + active_projection_id` 在同一事务切换。新 Generated Version、draft 编辑或失败均不提前替换旧 active。
- runtime provenance 漂移只标记当前 active Dossier `analysis_outdated`，不使其失效或自动重跑。

## Evidence

- `npm test`：56 files / 192 tests PASS；
- `npm run lint`、`npm run typecheck`、`npm run build`、`git diff --check`：PASS；production build 包含 Dossier GET/PATCH/approve routes；
- `npm run smoke:repository-dossier`：空 scratch PostgreSQL 13/13 migration 后 PASS，覆盖有效 Citation/coverage、append-only Version、完成幂等、无效 hash 拒绝、Projection 编辑/隐藏/降权、批准激活、重跑 pending 保留旧 active、旧 Projection supersede 与 active outdated；
- `npm run smoke:repository-dossier-api`：production server PASS，覆盖页面 SSR、匿名拒绝、coverage/Citation DTO、claim PATCH、unknown claim 404、draft 编辑期间 active 延续、批准、visibility 降为 private 后批准立即拒绝；
- production server 日志无新的 500；两份 scratch database、临时 Artifact 与 server 均已移除。

## 未提前声明的后续范围

- 当前 Dossier producer smoke 使用受控结构化 fixture，只证明 Host 合同，不是 Pi 或固定 `new-api` 的真实模型生成；真实 image、BoxLite、产品 Skill、一次修正与首次/重跑接线由 Phase 4.1 至 4.8 交付。
- 固定 public/private Repository、约 10 题、桌面/移动真实浏览器、全部 API 与全站回归仍由 Phase 7 验收；本 Review 不勾选任何 `SPEC-002` 最终 AC。

## 结论

`PASS_WITH_NOTES`

Notes 均由后续未完成 Phase 明确拥有，不影响 Phase 3 的 Host Dossier、Projection 与 active/outdated 领域完成。下一路由：进入 Phase 4.1，锁定并构建只含 Askme 产品 Skill 与只读工具的 Code Agent image。
