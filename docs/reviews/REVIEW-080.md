# REVIEW-080：PLAN-015 统一知识投影 Reconcile Change Review

## 审查对象

- Objective：`OBJ-010`
- Plan：[PLAN-015](../plans/PLAN-015.md)
- Spec：[SPEC-002](../specs/SPEC-002.md) `AC-KB-003`
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- 前序 Review：[REVIEW-079](REVIEW-079.md)
- 审查日期：2026-08-14

## 正确性与边界

- 统一列表在 PostgreSQL `UNION ALL` 结果上完成排序、`LIMIT` 和 `OFFSET`；高页码只返回 `pageSize` 行，不再把前序候选集合拉入 Web 内存。Knowledge Item 与 Repository Wiki 使用稳定 discriminator，ID 相同也不会混淆选择或详情请求。
- Repository 行只接受 owner 匹配、非 disabled/private、active Revision、active Approved Projection、匹配 Dossier 与完整 Projection pages；计数、总数、搜索、列表和详情使用相同准入语义。pending 新 Dossier 不替换旧 active，visibility 降为 private 后列表、详情和 Agent retrieval 同时撤回。
- Repository Wiki 详情只读；Knowledge Item PATCH 未接受 Repository ID。Generated Markdown、Approved edited Markdown 与源码 Citation 没有复制进 `knowledge_items`，批准事务和 EvidenceProvider owner 未改变。

## 兼容性、资源与失败

- 现有 `/api/knowledge` 只增加 `sourceKind`、`wikiPageCount` 和 Repository 行；现有 Knowledge Item 详情与编辑路径保持不变。新增 active Repository 详情 API 需要 Candidate session，并按 owner 与当前 visibility 每次复核。
- 无 migration、数据回填或新依赖；当前 Compose 数据在重建和隔离 smoke 前后均为 `users=2`、`repositories=2`、`active_repository_wikis=2`、`knowledge_items=18`、`migrations=17`。
- 高页码、三种排序、空页、Projection 不完整、未知/未授权详情均 fail closed 或返回稳定空结果/404；Web ready 且近期日志无新增 error。

## Evidence

- `npm test`：70 files / 245 tests PASS。
- `npm run lint`、`npm run typecheck`、`npm run build`、`npm run verify:surface-matrix`、`git diff --check` PASS；surface matrix 为 18 pages、60 API routes、66 methods。
- `smoke:repository-dossier` PASS：统一列表、跨来源分页、搜索筛选、active 详情、Candidate/Public retrieval、pending 延续、private 即时撤回和临时数据清理均成立。
- 当前 PostgreSQL HTTP 查询验证 `sort=title`、`sort=confidence`、`sort=updated&page=100000&pageSize=100` 均 200；高页码返回 0 行且 total 保持 20。
- 真实桌面与 390×844 浏览器：代码仓库分类为 2，两个 Wiki 为 6/7 页；多页 Markdown 与 Citation 可读，无横向溢出，移动端 console 无 warning/error。Candidate Preview 的 copybook 回答显示 4 条 Repository Citation；Public Chat 的英文网格问题正确回答四类网格并显示 `README.md:1-100`。

## Notes

- 当前 Wiki retrieval 是词法检索。英文 Wiki 的英文问题可以准确命中具体段落；中文同义问题可能只命中概要并返回证据不足。该限制不阻断“Approved Wiki 已进入统一知识与 Agent”目标，但本次不宣称解决跨语言语义召回。

## 结论

`PASS_WITH_NOTES`

Notes 不影响 `AC-KB-003`、权限、安全、验收或恢复。下一路由：完成文档索引与 Plan/Progress/Git 对账后关闭 PLAN-015。
