# REVIEW-005：PLAN-001 Change Review（初审）

## 审查对象

- 制品：`PLAN-001` 当前完整变更
- Revision：`HEAD 013ad0c + working-tree sha256:6a184e30315d6f4a824b13f33648acbd75848d3ebd397f30fc80e780a642579a`
- 审查范围：Phase 1–3 的 Spec、Design、Web/worker/database、身份、DeepSeek、Docker、测试与 Operation Evidence
- 审查日期：2026-08-11

## 发现

1. **高：本地默认凭证服务被发布到所有宿主网卡。** `docker-compose.yml` 使用 `3000:3000` 和 `55432:5432`，在具有局域网/公网路由的主机上会暴露带已知 local-only 默认账号和数据库密码的服务，违反单机 Docker 边界。应显式绑定 `127.0.0.1`。
2. **高：Secret 注入范围大于消费者。** 公共 `x-app-environment` 同时包含 DeepSeek key 与 Candidate/Admin bootstrap 密码，导致 migrate 获得不需要的 AI key，Web/worker 获得不需要的账号明文密码。应拆分 database、runtime 与 bootstrap 环境；每个服务只获得自身消费者字段。
3. **中：长期服务异常退出后不会自动恢复。** worker 遇到数据库短暂断开会退出，Web 也可能因未处理进程错误退出；Compose 没有 restart policy，ready 将永久 degraded，直到人工介入。应给 db/web/worker 增加 `unless-stopped`，migrate 保持一次性。
4. **中：项目事实入口仍是初始化占位。** 根 `AGENTS.md` 的项目概述/结构尚未填充，根目录没有 `README.md`，导致后续 Agent 和本地用户无法从仓库恢复已验证技术栈、运行入口、数据保留与当前未完成边界。应按当前代码和 Operation Evidence 补齐，不得把后续业务描述为已交付。

## 已确认 Evidence

- 31 个 Spec AC 唯一；Design 初审冲突已 Reconcile 并复审 PASS。
- 依赖审计 0 vulnerabilities；8 个 unit PASS；lint、typecheck、build、migration、bootstrap、DeepSeek availability、HTTP auth smoke 与 Docker restart 均有当前 PASS Evidence。
- 未发现真实 Secret 被 Git 跟踪或输出；`.env`/`.env.local` 均被忽略，日志只输出安全元数据。

## 结论

`FAIL`

下一路由：返回 `autogo-change-implement` 修复 Compose 网络、Secret owner 和恢复策略；重新执行 Compose 配置审计、构建、健康、auth smoke 后再次 Change Review。普通失败不回滚已通过的基础实现。

处置：四项发现均已修复并获得当前验证，复审见 [REVIEW-006](REVIEW-006.md)。
