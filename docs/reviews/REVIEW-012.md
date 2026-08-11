# REVIEW-012：PLAN-003 Change Review（复审）

## 审查对象

- 制品：`PLAN-003` 当前完整变更与 `REVIEW-011` Reconcile 结果
- Revision：`HEAD 914a9bf + feat/askme-mvp-full-loop working tree（提交前）`
- 上层 Objective：`OBJ-001`
- 审查日期：2026-08-11

## 初审发现处置

1. **Source 删除不会恢复旧公共回答。** `chunks` 删除前由数据库 trigger 永久标记受影响 assistant message；公共与 Candidate thread 同时按当前 visibility/status 和永久失效标记投影，真实 smoke 已验证 Citation 级联删除后正文仍被替换且不含原结果。
2. **中断回答具有确定恢复状态。** 读取会话时把超过 2 分钟的 pending assistant 标记为 `REQUEST_INTERRUPTED`；完成写入只接受仍为 pending 的占位符，避免迟到结果覆盖恢复结论。
3. **匿名写入边界完整。** Chat、新建 session、推荐问题刷新和 feedback 均使用 visitor / conversation 作用域的原子限流；Chat 的 429 返回 `Retry-After`，idempotent replay 在限流前返回已有结果。
4. **运行日志使用安全错误投影。** 5xx 只记录 request id、稳定错误码、状态和 Error type，不记录底层错误文本或用户输入。
5. **Published + Public Mode off 可原链接恢复。** Publish 动作在已发布状态下幂等检查 Public Mode；关闭后匿名接口立即 404，Publish 页面可重新启用同一 slug，当前 smoke 已覆盖。

## 当前 Evidence

- `npm test`：29 files / 100 tests PASS；`npm run typecheck`（含 `next typegen`）、`npm run lint`、`git diff --check` PASS；`npm audit --audit-level=high` 为 0 vulnerabilities。
- Privacy smoke：revision、幂等 visibility、确认失效/重确认、Interviewer 投影与页面 SSR PASS。
- Candidate Agent smoke：真实 DeepSeek、幂等、注入拒答、无证据、Citation、反馈、设置、推荐问题、审计与页面 SSR PASS。
- Publication smoke：readiness、随机 slug、Public Mode 恢复、Candidate/Public 同投影、visibility 即时变化、撤销、旧链接 404、再发布新 slug 与审计 PASS。
- Public Chat smoke：HttpOnly visitor、多轮 DeepSeek、真实 Citation、跨访客隔离、反馈治理、限流、stale pending 恢复、visibility/Source 删除脱敏、撤销后 profile/chat/page 404 PASS。
- Visibility retrieval smoke：Candidate Preview 3、Public Answer 2、Public Highlight 1，跨 owner 结果为 0。

## 发现

未发现仍影响 PLAN-003 目标、隐私授权、会话隔离、发布恢复、Citation 完整性、运行边界或 Docker/Chrome 验收的阻塞项。

## 结论

`PASS`

下一路由：重建本地 Docker，完成 Candidate 隐私 → Agent 预览 → 发布 → 匿名 Chat → 撤销的真实 Chrome 桌面与 390 × 844 验收。
