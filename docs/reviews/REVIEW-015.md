# REVIEW-015：DESIGN-002 Design Review

## 审查对象

- 制品：`DESIGN-002`
- Revision：`HEAD c2a3be2 + DESIGN-002 working tree（实现前）`
- 上层 Objective：`OBJ-001`
- 父 Plan：`PLAN-004`
- 审查日期：2026-08-11

## 发现

- 设计从 `AC-ADMIN-001`–`003`、UI 主控件和私有原文禁区反向定义了 Overview、Candidates、Published Agents、Reports、Content Review、Settings、搜索与邀请合同，没有加入 ATS、评分或招聘决策。
- Candidate、publication、Content Flag、平台策略和审计继续复用现有 PostgreSQL owner；新增持久状态只服务于一次性真实 Admin 邀请与现有约束加固，没有双重事实源或不必要缓存。
- 账号暂停会撤销 session，公共访问已经逐请求检查账号与 publication；Agent pause/restore 和 review 状态机均有并发冲突语义、审计与恢复路径。
- Admin 安全投影明确禁止选择 Material/Chunk/Message 原文、存储路径、凭证与 Secret；跨域搜索和 Content Review 只使用账号治理字段、公开 Agent 标识与 `safe_summary`。
- 时间范围、无历史基数和全零数据均有确定语义，允许真实零桶但禁止设计稿曲线、示例姓名与伪同比。
- Settings 策略使用 allowlist 且每个键有实际消费者；DeepSeek、SMTP 与数据库 Secret 没有浏览器或业务表投影。
- SMTP 外部副作用采用 `pending → sent|failed`，数据库只保存 token hash；失败状态不可接受、重试生成新邀请，避免把邮件调用包装成事务性假成功。
- migration 仅增加表、索引和约束，并为既有 paused/重复 Flag 数据提供先兼容再约束的路径；代码回滚不会删除现有业务数据。
- 验证计划覆盖 role、私有列禁区、状态即时传播、真实空态、Docker 与两种 Chrome 视口，强度与风险匹配。

未发现会导致权限扩大、状态分叉、不可恢复迁移或静态假数据回流的阻塞问题。

## Notes

- 本地默认没有 SMTP 配置时，只能验收明确的 `not_configured` 产品状态与受控 adapter 契约；只有测试环境提供真实 SMTP 后才可报告实际邮件已发送。该 Evidence 边界不阻塞默认本地产品闭环。

## 结论

`PASS_WITH_NOTES`

下一路由：将 `DESIGN-002` 标记为 active，从 PLAN-004 Item 1.3 开始按 migration、domain/API、UI、Docker/Chrome 顺序实施；外部邮件成功结论继续受实际 SMTP 配置约束。
