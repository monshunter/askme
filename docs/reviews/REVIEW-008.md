# REVIEW-008：PLAN-002 Change Review（初审）

## 审查对象

- 制品：`PLAN-002` 当前完整变更
- Revision：`HEAD 4a5ba0a + feat/askme-mvp-full-loop working tree（修复前）`
- 上层 Objective：`OBJ-001`
- 审查日期：2026-08-11

## 发现

1. **高：处理真实资料时 worker 会被就绪检查误判为 stale。** `src/worker.ts` 只在领取任务前刷新 heartbeat，而 `src/server/jobs/process-ingestion.ts` 的 DeepSeek 请求最长可运行 60 秒；`src/app/api/health/ready/route.ts` 和 Dashboard 均以 30 秒为新鲜阈值。一个仍在正常处理的 worker 因此可能让 ready 返回 503，并把健康状态显示为 stale。heartbeat 必须独立于领取循环持续刷新，同时保留进程停止与写入失败的可观测行为。
2. **中：Candidate 的部分 API 失败不能收敛为可恢复界面状态。** `materials-client.tsx` 的 refresh、Connector 与 retry，以及 `knowledge-client.tsx` 的列表、详情和保存请求直接等待 `fetch` / `response.json()`；网络中断或非法响应会产生未处理 Promise，`Connecting…` / `Loading…` 可能不复位，也没有稳定可读反馈。该行为违反 `SPEC-001` 3.2.3 的失败可恢复要求，也不满足当前目标新增的“前端所有功能正常对接后端 API”。应统一安全解析 API 响应，并为每条用户操作补齐 `try/catch/finally`。

## 已确认 Evidence

- `npm test`：12 files / 57 tests PASS；`npm run typecheck`、`npm run lint`、`git diff --check` PASS。
- Docker db/web/worker 正常，ready 为 200；Chrome 健康路径已完成 GitHub 导入、DeepSeek 索引、知识搜索/详情、应用内取消/确认删除。
- 1448 × 1086 与 390 × 844 的 Dashboard、Upload Materials、Knowledge Base 均无横向溢出；健康路径 console error 为 0。
- UI 删除后 `materials=3`、`knowledge_items=20`、孤儿 Knowledge Item 为 0，上传卷文件与保留资料一一对应。

## 结论

`FAIL`

下一路由：返回 `autogo-tdd` 与 `autogo-change-implement`，先用失败测试锁定独立 heartbeat 和客户端网络/非法响应映射，再修复实现、扩大回归验证并重新 Change Review。

## 处置

两项发现均已通过 TDD 修复；复审时追加发现并修复 AI evidence 重复位置与动态资源 ID 非法输入边界。最终结论与当前 Evidence 见 [REVIEW-009](REVIEW-009.md)。
