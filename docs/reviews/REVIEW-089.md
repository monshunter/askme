# REVIEW-089：SPEC-001 / SPEC-002 认证、游客与回答增量 Spec Review

## 审查对象

- Objective：`OBJ-012`
- Plan：[PLAN-017](../plans/PLAN-017.md)
- Spec：[SPEC-001](../specs/SPEC-001.md) `sha256:871cba69028cb0300822b91cc8c1ae2c0d0c264f1f263a03a4946921a07fd1e2`
- Spec：[SPEC-002](../specs/SPEC-002.md) `sha256:5c436d747588b4c6bc50a48bc2a9f7ab09c9bfe4246fd19cdb3b8f6b22cb224b`
- 审查日期：2026-08-14

## 一致性与边界

- `SPEC-001` 继续拥有 Candidate、Interviewer 与权限产品边界，没有新建重复认证或多租户 Spec；自助入口只能创建 Candidate，Admin 邀请和权限提升不受影响。
- 认证合同覆盖注册、登录、注销、忘记密码、单次重置和登录后改密，并明确防枚举、旧 session 撤销、冻结账号、密码/token 保密和 SMTP 真实失败语义，不把“已发送”模拟为成功。
- Browser Visitor Identity 明确由一个 origin 的 localStorage 拥有；同一游客跨 Agent 复用身份但按 publication 分 Conversation，两个浏览器、伪造资源 id、SSE、反馈和来源访问都在同一隔离合同内。
- `SPEC-002` 继续拥有 Repository 回答边界；方括号 marker 只做无歧义 canonical 化，未知、越界或重复 marker 仍 fail closed。明确函数实现意图只在唯一且已授权 Repository 时确定性 Deep，不扩大权限或替代多仓库歧义处理。

## 可验收性

- `AC-AUTH-003/004` 可由数据库 token/session 状态、真实 SMTP 邮件、API 与浏览器完整链路独立验证。
- `AC-CHAT-005` 可由两个隔离浏览器 storage、两个 publication、跨会话 message/run/source 负例和旧 cookie 迁移验证。
- `AC-ANSWER-002` 同时固定 Provider 原始 `[S7]` 回归与 copybook `paginate` 真实 Deep/Citation 用户结果，不会用 parser 单测替代运行验收。

## 结论

`PASS`

下一路由：审查 [DESIGN-001](../architecture/DESIGN-001.md) 与 [DESIGN-005](../architecture/DESIGN-005.md) 的状态、迁移、安全和恢复设计。
