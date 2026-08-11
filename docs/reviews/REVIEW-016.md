# REVIEW-016：PLAN-004 Change Review（精确视口验收前）

## 审查对象

- 制品：`PLAN-004` 当前完整工作树
- Revision：`HEAD c2a3be2 + feat/askme-mvp-full-loop working tree（提交前）`
- 上层 Objective：`OBJ-001`
- 审查日期：2026-08-11

## 审查范围

- Admin migration、持久状态、Overview/Candidate/publication/report/review/settings/search/invitation domain service、Route Handler、UI 和公共 Chat 策略消费者。
- Admin role 边界、Candidate 私有原文禁区、状态并发、审计、外部 SMTP 失败语义、Docker build/smoke 和 Chrome 主链路。
- `AC-ADMIN-001`–`003` 与 `PLAN-004` 已完成的 Phase Items。

## 新鲜 Evidence

- 37 test files / 125 tests PASS；`npm run lint`、`npm run typecheck`（含 `next typegen`）与 `git diff --check` PASS。
- Docker production build、migration、Web/worker 重建与 readiness PASS；`smoke:admin` 当前再次证明角色边界、真实聚合、安全投影、session 撤销、公共传播、review 状态机、策略持久化、审计和 SMTP 未配置显式失败。
- Chrome 在真实 `1920 × 912` 内容视口完成 Admin Overview、Candidate suspend/restore、Agent pause/restore、Review resolve/dismiss、Settings、Reports 与三域搜索；Admin/Public console 为空且没有水平溢出。
- 专用 browser fixture 已按精确 ID 清理。完整场景与唯一未验证条件由 [OP-004](../operations/OP-004.md) 保存。

## 发现

- Admin SSR 与 `/api/admin/*` 共享同一 domain service；layout 与每个 Route Handler 分别实施页面和 API 的 Admin session/role 边界，没有仅客户端鉴权。
- Candidate、publication 与 review 写入在 PostgreSQL transaction 和 row lock 内完成；重复动作幂等，非法或终态转换返回稳定 `409`，公共入口每次读取当前账号/publication 状态。
- Admin 查询未选择 Material storage path、Chunk/Message 原文、password/token hash 或 Secret；Content Review 与全局搜索只使用账号治理字段、公开 Agent identity 和 `safe_summary`。
- 平台策略只接受 allowlist 键并由 public session/chat/feedback 消费；SMTP token 只存 hash，未配置时拒绝邀请且不创建伪持久成功。
- 构造 Candidate、Agent 和 Review 数据只位于 Smoke/Chrome fixture，产品页面没有设计稿姓名、指标或样例曲线数据源。

未发现影响 `AC-ADMIN-001`–`003` 正确性、安全性、数据一致性或 Docker 主链路的实现缺陷。

## 缺失 Evidence

- `PLAN-004` Item 4.3 要求的 Admin `1448 × 1086` 与 `390 × 844` 精确 Chrome 验收尚未执行。当前插件无法设置内容视口，且浏览器安全策略禁止间接规避；恢复条件已唯一记录在 `OP-004`。
- SMTP 未配置是本地默认能力状态，因此只验证了明确不可用与无伪成功；没有把未运行的真实邮件发送报告为通过。

## 结论

`BLOCKED`

下一路由：等待用户在保留的 Chrome 标签中手动设置两个精确响应式 viewport；完成真实截图、主操作、overflow 与 console 验收后重新执行 Change Review。`PLAN-004` Item 4.3、4.4 与 Progress 保持未完成。
