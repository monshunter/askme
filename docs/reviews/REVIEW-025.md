# REVIEW-025：DESIGN-004 Design Review

## 审查对象

- 制品：`DESIGN-004`
- Revision：`HEAD a32715f + DESIGN-004 working tree`
- 上层 Plan：`PLAN-006`
- 关联 Spec：`SPEC-001`
- 审查日期：2026-08-11

## 发现

- 默认 Compose 端口和 volume 名称不变，参数化只为隔离验收提供覆盖点，不改变现有 `askme-local` 启动、持久化或 reset 语义。
- 唯一 project/volume 前缀、存在即拒绝、清理前格式校验和退出 trap 共同限制破坏范围；当前环境不参与 stop、restart 或 volume 删除。
- from-zero 后创建真实会话、上传文件、worker 索引知识和审计，再做 restart 前后同一状态比对，能同时证明数据库和上传 volume 的持久性，不以容器 healthy 代替用户数据结果。
- request ID 字符白名单、响应 header/envelope 同值、5xx 日志字段白名单和 sentinel 扫描直接对应日志注入与 Secret/私有原文泄露风险，没有引入第三方观测系统。
- worker job 继续使用现有持久 job ID 和结构化结果；没有新增平行 trace 状态或数据库迁移。
- 失败时清理仅限本轮隔离资源，当前 `askme-local` 的显式 reset 仍保留 Human Gate 边界，恢复路径成立。

## Notes

- Docker 宿主随机端口和 project 名覆盖行为必须用当前 Compose 版本的 `config`/真实启动验证，不能只依赖设计推断。
- 日志无泄露结论只覆盖应用与 worker 结构化日志，不声明 Docker Engine、PostgreSQL 内部日志或外部代理绝对不会记录其自身配置。

## 结论

`PASS_WITH_NOTES`

Notes 不影响本地目标、安全或恢复，可进入实现；若 Compose 覆盖或精确清理验证失败，必须回到本设计调整，禁止对当前 `askme-local` 试错。
