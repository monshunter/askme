# REVIEW-099：DESIGN-001 公开身份补全与发布可达性 Design Review

Verdict：`PASS`

- Objective：`OBJ-014`
- Design：[DESIGN-001](../architecture/DESIGN-001.md) `sha256:609977668f7b428ed9cf1a2e474c7409d9bc8cb4bc43a77116b9e1d2ccdaabbf`
- Spec：[SPEC-001](../specs/SPEC-001.md) `sha256:8acaf7f1fdebf79be33adc7e8993bf68db053651534fb551cbd7f0dd9c0f4633`
- 审查日期：2026-08-14

## 边界与状态

- 复用 `users` 现有公开资料列和 Candidate session，不新增权限、profile 表或 migration；现有与新账号天然共享同一写入能力。
- 写入边界不接收 owner、role 或账号状态，只按已认证 Candidate id 更新，且以字段规范化、长度限制和安全审计保护数据边界。
- readiness 仍由 publication service 每次读取数据库事实计算；Profile 保存通过新 Server 请求返回 Agent 页，不引入客户端缓存同步状态。

## 失败与恢复

- 非法输入留在公开资料区并提供稳定错误；返回地址采用内部 allowlist，避免开放重定向。
- 缺失职业头衔时继续禁用发布，不自动猜测公开身份；应用回滚不涉及 schema 或数据迁移。
- 账号资料与改密在同一路由不同卡片中隔离，避免把公开资料更新错误绑定到密码验证或 session 撤销。

## 复杂度与验证

- 单一 profile service/route、现有账号页和发布 readiness link 是满足合同的最小组件集合。
- PostgreSQL 隔离测试、Route 输入/重定向测试和真实浏览器现有/新账号场景足以覆盖主要故障模式。

## 结论

Design 满足 Spec，边界清晰、失败可恢复且没有不必要的持久概念，可进入 TDD 实现。
