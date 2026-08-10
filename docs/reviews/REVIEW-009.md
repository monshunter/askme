# REVIEW-009：PLAN-002 Change Review（复审）

## 审查对象

- 制品：`PLAN-002` 当前完整变更与 `REVIEW-008` Reconcile 结果
- Revision：`HEAD 4a5ba0a + feat/askme-mvp-full-loop working tree（提交前）`
- 上层 Objective：`OBJ-001`
- 审查日期：2026-08-11

## 初审发现处置

1. **worker heartbeat 已独立于资料处理循环。** `startWorkerHeartbeat` 在领取与 DeepSeek 处理期间按 10 秒顺序刷新，写入失败输出安全错误码并可停止；真实 Docker 两次观测的 `last_seen_at` 相差约 10 秒，ready 保持 `worker=ready`。
2. **Candidate API 失败已收敛为可恢复 UI 状态。** Materials 的刷新、Connector、重试与删除，以及 Knowledge 的列表、详情和保存统一使用安全 API 解析；网络失败与非法 JSON 具有稳定反馈，loading / connecting / deleting 均在失败路径复位。

## 复审追加边界

- AI Knowledge Organization 在持久化前拒绝重复 `evidencePositions`，避免数据库主键异常被误归为内部失败。
- 材料删除/重试与知识详情/编辑在进入 PostgreSQL 前校验 UUID；非法路径与跨 owner 访问统一返回不泄露资源事实的 404。
- 按仓库内 Next.js 16.3 指南，`typecheck` 先执行 `next typegen`，`next-env.d.ts` 改为生成且不纳入版本控制，避免类型门禁依赖残留 `.next/dev/types`。

## 当前 Evidence

- TDD Red：独立 heartbeat、客户端网络/非法响应、重复 evidence position 与资源 ID 测试均先失败；对应最小实现后 Green。
- `npm test`：15 files / 65 tests PASS；`npm run typecheck`（含 `next typegen`）、`npm run lint`、`git diff --check` PASS；`npm audit --audit-level=moderate` 为 0 vulnerabilities。
- 当前生产 Docker build PASS：Next.js 16.3 编译、完整 TypeScript、13 个页面静态生成和 standalone 镜像均成功；重建后的 db/web/worker 正常，ready 为 database/migration/worker/ai 全部 ready，相关错误日志为空。
- 当前 Docker API 证明非法 material delete、material retry 与 knowledge detail 路径分别返回 `MATERIAL_NOT_FOUND` / `KNOWLEDGE_NOT_FOUND` 404；material lifecycle smoke 再次证明 owner 隔离、重试、删除和安全响应投影。
- 当前数据库 `materials=3`、`knowledge_items=20`、孤儿 Knowledge Item 为 0，最新 heartbeat age 约 3 秒。
- [OP-002](../operations/OP-002.md) 已保存真实 GitHub → worker/DeepSeek → Knowledge → 搜索/详情 → 删除的 Chrome 桌面与移动 Evidence。

## 发现

未发现仍影响 PLAN-002 目标、数据隔离、错误恢复、兼容性或后续隐私/Agent 交付的阻塞项。

## 结论

`PASS`

下一路由：执行 `autogo-change-close`，同步索引、Plan、Progress 与 Git；PLAN-002 原子提交后进入同一 Objective 的下一份 Plan。
