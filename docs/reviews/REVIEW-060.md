# REVIEW-060：PLAN-014 Phase 2 Candidate Repository 交付增量 Change Review

## 审查对象

- Objective：`OBJ-009`
- Plan：[PLAN-014](../plans/PLAN-014.md)
- 当前 Item：`2.4 交付 Candidate Repository 同步、重新同步、visibility 与状态反馈体验`
- Spec：[SPEC-002 §4、§7、AC-REPO-001 至 AC-REPO-003](../specs/SPEC-002.md)
- Design：[DESIGN-005 §5.1、§6、§9](../architecture/DESIGN-005.md)
- 审查日期：2026-08-13

## 审查范围

- Candidate `GET/POST /api/repositories`、`PATCH /api/repositories/:id` 与 `POST /api/repositories/:id/sync`；
- owner、role、输入大小、JSON、Repository id 与 visibility 校验；
- `/workspace/repositories`、Candidate 导航、首次同步、重新同步、可见性和安全反馈；
- PostgreSQL Repository/Revision/Artifact/sync job/audit 一致性与 production build；
- 固定 public Revision `QuantumNous/new-api@ccd535ef8e50cf6e5846a59278c40b7ff59d1b7d` 的隔离 smoke。

## Findings

无阻塞 correctness、安全、兼容或范围发现。

已在审查前 Reconcile 的缺陷：visibility 更新 SQL 曾让 PostgreSQL 对参数 `$3` 同时推断 `text` 与 `visibility`，真实 PATCH 返回 500。查询已对参数和比较常量显式使用 `visibility` cast；同一参数化 SQL 与完整 API smoke 均转绿。

## Evidence

- `npm test -- src/server/repositories src/server/resource-id.test.ts`：6 files / 16 tests PASS；
- `npm run typecheck`：PASS；
- `npm run build`：PASS，24 个页面路由生成成功，包含 Repository 页面与三个 Route Handler surface；
- 定向 ESLint 与 `git diff --check`：PASS；
- 空 scratch PostgreSQL 完成 13/13 migration 与 Candidate/Admin bootstrap；
- `npm run smoke:repository-api`：production server 上 PASS，固定完整 SHA、1,956 个 eligible files、visibility 更新和同输入 revision 幂等重用成立；
- 终态数据库：1 Repository、1 Revision、1 Artifact、1 sync job、3 repository audit events，Artifact `reference_count=1`；
- manifest 与 `.tar.zst` 均实际存在且 mode 为 `0444`；隔离 server、scratch database 与临时 Artifact/Upload 目录在审查后已移除。

## Notes

- 非 `private` visibility 创建 Dossier analysis run、review status 与 active 原子切换由 Phase 3 的 3.1 至 3.3 交付，本增量只建立可操作的同步/visibility surface，不把 `stored` 伪装成 `active`。
- 私有固定仓库一次性 Token、撤权与泄露扫描仍由 7.5 验收；本 Review 不提前勾选 `AC-REPO-001` 或 `AC-REPO-002`。
- 当前 Evidence 含 production SSR 和 API 链路，不替代 7.7/7.10 的桌面/移动真实浏览器交互、错误态、console/network、可访问性和横向溢出验收。

## 结论

`PASS_WITH_NOTES`

Notes 均由后续未完成 Phase 明确拥有，不影响 2.4 的实现完成。下一路由：进入 Phase 3.1，生成带有效 Citation 与诚实 coverage 的结构化 Generated Dossier。
