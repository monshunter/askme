# DESIGN-004：本地运行验收与可观测性收口设计

## 目标与边界

在不修改或清空当前 `askme-local` 数据的前提下，为 `AC-OPS-001`、`AC-OPS-002`、`AC-OBS-001` 与 `AC-TEST-001` 建立可重复的当前 revision Evidence。本设计只覆盖本地 Docker，不引入生产监控平台、日志采集依赖或外部基础设施。

## 当前事实与缺口

- Compose 已具备 db、migrate、web、worker、健康检查和 PostgreSQL/上传文件命名 volume，但宿主端口和 volume 实际名称固定，无法与当前环境并行做安全的空库验收。
- `scripts/docker-reset.sh` 只有 `--confirm askme-local` 才执行 `down --volumes`，普通 stop/start/restart 不删除 volume；当前缺少自动验证该门禁的入口。
- JSON API 已返回稳定 error code 与 body `requestId`；关键状态修改写入带 `request_id`、时间、结果和安全 metadata 的 `audit_events`；worker 日志已包含 `workerId`、`jobId`、`materialId`、结果和 error code。
- `x-request-id` 当前只截断、不校验，响应 header 未统一回写；健康检查与登录/注销重定向没有关联 header。服务端 5xx 日志已经只记录类型、状态、code 和 request ID，不记录异常 message、请求正文或 Secret。

## 运行生命周期方案

1. Compose 的默认行为保持不变，只把宿主 Web/PostgreSQL 端口和两个 volume 实际名称改为带当前默认值的环境变量。
2. 新增一个受保护的验收脚本，每次创建唯一的 `askme-acceptance-<数字>` project、随机宿主端口和同名前缀 volume。启动前若目标资源已存在则拒绝覆盖；退出时只允许清理通过固定格式校验的本轮资源。
3. 隔离栈从不存在的 volume 启动，等待 migration/bootstrap、Web health 与 worker ready 收敛。随后通过真实登录和上传创建账号会话、文件、资料、ingestion job、知识及审计记录。
4. 重启 db、web、worker 后，用同一 session cookie 重新访问 API，并对比 material、knowledge、session、文件 checksum、request ID 审计和 job 结果。验证完成后删除隔离 project 与 volume；当前 `askme-local` 不停止、不重启、不清理。
5. 脚本验证 `scripts/docker-reset.sh` 在缺少精确确认和错误目标时均拒绝执行；不对当前环境执行正确 reset。

## Request 与日志合同

- 只接受 1–100 个 ASCII 字母、数字、`.`、`_`、`:`、`-` 组成的上游 `x-request-id`；无值或非法值由服务端生成 UUID，阻止不受控日志内容进入关联字段。
- JSON 成功/失败、健康响应和登录/注销重定向均回写 `x-request-id` header；JSON envelope 继续保留同一 `requestId`，不改变现有客户端字段。
- 5xx 结构化日志只允许 `event`、`requestId`、稳定 `code`、HTTP `status` 与 `causeType`；禁止 error message、stack、body、Token、Secret 和完整私有原文。
- worker 继续以 `workerId + jobId + materialId + attempt + outcome/errorCode` 记录收敛结果；资料正文、AI prompt/answer 和外部 token 不进入日志。
- 审计 metadata 只保存状态、数量、ID、字段名、操作理由等治理事实；资料原文、密码、session/visitor/invitation token、DeepSeek key 不保存。

## 失败、恢复与清理

- 验收栈任一步失败都保留当前输出并进入退出 trap；trap 先验证 project/volume 名称，再只清理本轮隔离资源。
- 既有同名资源、无法解析随机端口、ready 未收敛、状态快照不一致或日志出现 sentinel 时立即失败，不重试破坏性动作。
- 普通 `docker compose stop/start/restart` 仍保留 volume；实际清空 `askme-local` 只能由用户或已授权流程执行 `scripts/docker-reset.sh --confirm askme-local`。

## 验证映射

- `AC-OPS-001`：隔离空 volume 启动、migration/bootstrap、Web health、worker ready。
- `AC-OPS-002`：重启前后账号、活跃 session、资料、知识、上传文件 checksum 一致；reset 错误参数拒绝。
- `AC-OBS-001`：request header/body/audit 一致，worker job 可追踪，受控 5xx 日志字段白名单，日志 sentinel 扫描无泄露。
- `AC-TEST-001`：总测试、类型、lint、build、migration、隔离生命周期、全部 Docker smoke 与 Chrome E2E 均基于同一 revision。
