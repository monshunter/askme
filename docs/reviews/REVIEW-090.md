# REVIEW-090：DESIGN-001 / DESIGN-005 认证、游客与回答增量 Design Review

## 审查对象

- Objective：`OBJ-012`
- Plan：[PLAN-017](../plans/PLAN-017.md)
- Design：[DESIGN-001](../architecture/DESIGN-001.md) `sha256:3dd66694f05d20ae0b61c1a13b6844d0c43e4c4e6b9f8ec87bdcafbbd8efaf53`
- Design：[DESIGN-005](../architecture/DESIGN-005.md) `sha256:71f2eb7b63d13920a9e43b9f3b707e3d00bb2e134f9610b3b3e43bc9a4879c32`
- 审查日期：2026-08-14

## 边界、状态与复杂度

- 认证复用现有 `users`、`sessions`、Node `scrypt`、Nodemailer 与 SMTP 配置，只新增一次性 reset token 和不含原始标识的认证限流状态；没有引入 OAuth、第二用户表或平行 session 系统。
- 游客隔离继续使用现有 `conversations.visitor_token_hash` 和 `publication + visitor hash` 唯一约束；localStorage/header 负责浏览器身份，global HttpOnly cookie 只解决 EventSource/来源链接传输，旧 slug cookie 仅在初始化桥接，三者 owner 与优先级清楚。
- 30 天滚动期限在所有公共资源入口统一复核和续期；localStorage 清除创建新身份，不会因残留同步 cookie 自动恢复旧会话。bearer token 被复制会复制身份，这是显式且可测试的客户端安全边界。
- marker parser 只规范化单层 `[]`，随后仍执行格式、唯一性和 Evidence membership 校验；source-inspection classifier 只在唯一已授权 Repository 上覆盖 Router，保持普通 RAG、多仓库和权限门禁不变。

## 失败、迁移与恢复

- 密码重置使用锁定、一次消费、密码更新和全 session 撤销的事务边界；发送失败不伪造成功，新请求替代旧 token，恢复条件明确。
- 数据库迁移 additive 创建认证表并保留现有用户、session、public Conversation 与 token hash；游客 transport 切换提供旧 cookie 一次桥接，不需要破坏性回填。
- 本地 Mailpit 提供真实可观察邮件链路但不改变生产 SMTP 显式配置边界；Compose 保留 PostgreSQL/upload volume，回滚保留新表和旧数据。

## 结论

`PASS`

下一路由：进入 Phase 2，以失败测试修复 marker 和源码问题路由。
