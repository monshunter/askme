# REVIEW-026：PLAN-006 Change Review

## 审查对象

- 制品：`PLAN-006` 实现、测试、运行与文档 Diff
- Revision：`HEAD a32715f + PLAN-006 working tree`
- 关联 Spec：`SPEC-001`
- 审查日期：2026-08-11

## 范围与正确性

- Diff 只覆盖 `AC-OPS-001`、`AC-OPS-002`、`AC-OBS-001`、`AC-TEST-001` 所需的 Compose 参数化、隔离生命周期验证、request ID、worker pool 错误边界、测试与 owner 文档，没有重新实现或改变已闭环产品语义。
- Compose 的默认宿主端口与 volume 名称保持 `3000`、`55432`、`askme_local_pgdata`、`askme_local_uploads`；当前 `askme-local` 已使用同一 revision 无损重建并恢复 healthy/ready。
- 生命周期脚本只接受唯一 `askme-acceptance-<数字>-<数字>` project 和同名前缀 volume，目标已存在时拒绝覆盖；退出时清理前重新校验目标，成功后确认两个临时 volume 均不存在。
- `docker-reset.sh` 仍要求精确 `--confirm askme-local`，并固定 project 与默认 volume；隔离测试没有执行当前环境的正确 reset。
- from-zero 栈建立真实账号、session、上传文件、material、job、Knowledge Item 与审计，restart 后通过同一 session 和 checksum/ID/计数对比证明数据库与文件持久性，不以容器状态替代数据结果。

## 可观测性与安全

- 上游 request ID 只接受有界 ASCII 安全字符；JSON、健康与 auth redirect 响应回写同一 header，业务审计继续保存同一 request ID。
- API 5xx 日志使用字段白名单；测试证明私有 Error message 不进入日志。4xx 继续使用稳定 error code/envelope，不制造无意义服务端 error 日志。
- worker pool 的后台 error 由显式 listener 收敛为 `worker.pool.error + workerId + errorCode`，避免 Node 展开 client 对象；现有 worker job 日志仍保留 job/material/attempt/outcome 关联。
- 隔离 restart 日志对数据库、SMTP、Candidate/Admin、DeepSeek Secret 与完整私有 fixture 正文扫描无匹配；应用响应、审计与日志未引入 Token、密码或原文投影。

## 验证与兼容

- `npm test`：41 files / 138 tests PASS；`npm run typecheck`、`npm run lint`、`npm audit --audit-level=moderate` PASS，audit 为 0 vulnerabilities。
- 当前 working tree 完成 production Docker build、空库 migration/bootstrap、重启持久性、全部 HTTP/DB smoke 和 lease recovery；`askme-local` ready 为 database/migration/worker ready、AI configured。
- Chrome 当前 revision 完成 Candidate 7 页、Admin 7 页的 1448 × 1086 与 430 × 932 对账；公开 Agent 完成真实 DeepSeek 回答和 Citation，三个角色均无新 console error 或横向溢出。
- 浏览器 fixture、隔离容器、network 和 volume 已清理；当前 `askme-local` volumes 保留。

## Notes

- `verify:docker-lifecycle` 依赖可用 Docker Engine 和已配置 DeepSeek key，这是 `SPEC-001` 的本地总验收前置；脚本会在 AI 未配置或资料未收敛时显式失败，不降级为静态数据。
- 隔离构建生成的镜像层可由 Docker build cache 保留；它们不包含验收数据库或上传 volume，不影响数据清理结论。

## 结论

`PASS`

下一路由：执行 `autogo-change-close`，对账四条剩余 AC、PLAN-006、Objective、索引、Git 与原子 Commit。
