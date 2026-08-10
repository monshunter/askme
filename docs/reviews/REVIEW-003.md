# REVIEW-003：DESIGN-001 Design Review（初审）

## 审查对象

- 制品：`DESIGN-001`
- Revision：`sha256:c1ffd254498157461d929476f896552c80a626d9eb9cda731a54067224b2aab0`
- 上层 Plan：`PLAN-001`
- 审查日期：2026-08-10

## 发现

1. **阻塞：Notion 凭证生命周期与异步 worker 冲突。** 设计要求 worker 负责外部拉取，同时要求第三方 Token 不持久化；私有 Notion job 离开创建请求后无法获得凭证，失败重试也没有合法恢复条件。应将凭证请求内的远端读取与可重试的本地 ingestion 分开，或增加明确的加密 Secret owner。
2. **阻塞：`SESSION_SECRET` 没有实际职责。** 当前会话设计使用随机 token + 数据库 token hash，不依赖签名 cookie；自动生成且不持久的 Secret 反而会制造含糊恢复语义。应删除无消费者配置，或明确其唯一消费者和持久方式。

其余 owner 隔离、visibility 过滤、Citation、job lease、SSRF、防泄露、Docker 持久化和验证路径与 `SPEC-001` 一致，未发现必须增加消息中间件、向量数据库或对象存储的证据。

## 结论

`FAIL`

下一路由：返回 `autogo-solution-design` 修订 `DESIGN-001`，随后对新 revision 重新 Design Review。该失败不关闭 Plan，也不触发回滚。

处置：两项发现已在后续 revision 修正，复审见 [REVIEW-004](REVIEW-004.md)。
