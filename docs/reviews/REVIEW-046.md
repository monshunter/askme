# REVIEW-046：SPEC-001 Agent 发布与分享增量 Review

## 审查对象

- Objective：`OBJ-006`
- Plan：[PLAN-011](../plans/PLAN-011.md)
- Spec：[SPEC-001](../specs/SPEC-001.md)
- Revision：`opt/agent-publication-sharing` 当前 Spec Diff
- 审查日期：2026-08-12

## 一致性与边界

- 隐私确认继续由来源可见性的 policy revision 驱动：首次未确认、当前修订已确认和后续修订失效三个状态具有不同可见操作，且与既有“可见性变更使确认失效”合同一致。
- Candidate 发布合同取消独立链接预生成和下载边界，改为发布事务生成 opaque slug；成功后访问与撤销形成最小闭环。历史 draft 明确保留原 slug 发布兼容，避免把 API 退役错误扩大为数据迁移。
- `POST /api/publications/link` 被明确列为退役专用 API，而 publication current/publish/revoke 与匿名 public API 仍由主流程拥有，没有模糊删除范围。
- 公共页分享操作明确复制浏览器当前页面 URL，包含成功或失败反馈且不产生下载文件；正常与失败行为均可用浏览器测试验收。
- 增量 AC 使用现有 `AC-PRIV-002`、`AC-AGENT-004`、`AC-PUB-001` 以及新增 `AC-PUB-003` 承担，没有复制已有权限、聊天或 Admin 合同；在当前 Evidence 成立前均保持未勾选。

## 可测试性

- 隐私状态可由 revision 相等、首次无 confirmation 和旧 confirmation 三组服务状态验证，并由真实页面确认按钮可见性。
- 直接发布、历史 draft、链接 API 404、访问与撤销可由 publication smoke 和浏览器主流程验证。
- 公开页剪贴板写入与反馈可由真实浏览器上下文读取 clipboard 权限结果和页面状态验证，不依赖下载文件副作用。

## 结论

`PASS`

下一路由：进入 `PLAN-011` Phase 2，按 TDD 先建立状态与退役边界回归，再实施最小产品变更。
