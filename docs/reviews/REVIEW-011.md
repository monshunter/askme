# REVIEW-011：PLAN-003 Change Review（初审）

## 审查对象

- 制品：`PLAN-003` 当前完整变更
- Revision：`HEAD 914a9bf + feat/askme-mvp-full-loop working tree（提交前）`
- 上层 Objective：`OBJ-001`
- 审查日期：2026-08-11

## 当前 Evidence

- `npm test`：28 files / 99 tests PASS；`npm run typecheck`、`npm run lint`、`git diff --check` PASS；`npm audit --audit-level=high` 为 0 vulnerabilities。
- Privacy、Candidate Agent、Publication、Public Chat 与 visibility retrieval 的当前 PostgreSQL / HTTP smoke 均 PASS；真实 DeepSeek 预览与公共多轮回答返回并持久化真实 Citation。
- 匿名 visitor 隔离、幂等、限流、提示注入、无证据、visibility 即时变更、撤销后 404 与 public-permission projection 对照均已有当前 Evidence。

## 发现

1. `message_citations.chunk_id ON DELETE CASCADE` 会在 Source Material 删除时先移除 Citation；随后公共 thread 无法判断旧回答已失去授权来源，可能继续返回先前回答正文。
2. Web 进程在生成回答期间退出时，assistant placeholder 会永久保持 `pending`，同一 idempotency key 只会重复返回 pending，缺少中断恢复状态。
3. 匿名 suggested-question refresh 与 feedback 写入尚未使用 visitor 会话级限流，可被同一会话持续放大数据库写入与审计记录。
4. 通用 5xx 日志记录底层 `error.message`，数据库异常文本可能包含不适合进入运行日志的输入片段。
5. Agent 已发布后若 Candidate 在 Agent Preview 关闭 `Public Mode`，Publish 页面只显示撤销按钮，不能在原链接上直接恢复公开访问。

## 结论

`FAIL`

下一路由：Reconcile 到数据迁移、消息恢复、公共写限流、日志安全投影与 Publish UI；完成定向测试和真实 smoke 后重新 Change Review。
