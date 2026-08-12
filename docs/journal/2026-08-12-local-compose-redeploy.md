# 2026-08-12：Askme 本地 Compose 重新部署

记录类型：delivery

路由：Fast

## 目标与范围

使用项目现有 Docker Compose 入口重新构建并替换 `askme-local` 的 migrate、web、worker；保留 PostgreSQL 与上传 volume，不清理本地数据，不修改产品代码、配置、Secret 或外部依赖。

## 本次实际完成

- 预检确认 Docker Engine `29.4.0`、Docker Compose `v5.1.1` 可用，`docker-compose.yml` 配置校验通过；重部署前 db/web healthy、worker running。
- 执行 `scripts/docker-up.sh -d`，Next.js production build、TypeScript、24 个静态页面和 runtime 镜像导出成功；migration 重入完成，Candidate/Admin bootstrap 均报告已有账号、未重复创建。
- db 容器保持原实例运行；migrate、web、worker 按 Compose 依赖顺序完成重建与替换。新 web 镜像为 `sha256:5a842ada5647b716dfb34b23b2e20075bde8c72f55767fd8bf685f398361e1aa`，worker 镜像为 `sha256:49077eaaa12cae817ad3802c991f3420da8dc3ff750915057845bba58a61afed`。
- 重部署后 web 为 healthy、worker running；`/api/health/live` 返回 `live`，`/api/health/ready` 返回 database、migration、worker `ready` 和 AI `configured`。
- 重部署前后数据库计数均为 `users=2`、`schema_migrations=11`；`askme_local_pgdata` 与 `askme_local_uploads` 的既有创建时间未变化，未执行 reset、down volumes 或数据清理。
- Compose 网络内 auth smoke 通过 Candidate/Admin 登录、角色解析、Candidate Admin guard、登出和 session 撤销。首次从临时容器使用默认 `127.0.0.1` 运行时因请求指向容器自身而 `fetch failed`；改为 `ASKME_BASE_URL=http://web:3000` 后通过。

## 当前边界与风险

- 本次只验证构建、migration 重入、运行健康、数据计数与 auth 核心场景；未运行完整产品 smoke、真实浏览器 E2E 或 DeepSeek 实际请求。
- 工作树原有 Harness 修改未被改动，也不属于 runtime 镜像最终复制的产品目录；本次 Journal 与 Index 单独收口。

## 恢复方式

- 当前服务入口为 `http://127.0.0.1:3000`；异常时先用 `docker compose ps`、ready 接口和 `docker compose logs web worker migrate` 读取现场。
- 本次未删除数据。若需要再次行为不变重启，可继续使用 `scripts/docker-up.sh -d`；不得使用 `scripts/docker-reset.sh` 代替普通恢复。

## 预期 Commit subject

`docs: record local Compose redeploy`

Journal 不回填 Commit hash；实际关联由 `git log -- docs/journal/2026-08-12-local-compose-redeploy.md` 查询。
