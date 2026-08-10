# Askme

Askme 是个人职业知识库 Agent。Candidate 用真实职业资料建立 Career Knowledge Base，审核隐私边界并发布 Agent；Interviewer 通过 Chat 获得有来源依据的回答。

产品合同见 [SPEC.md](SPEC.md) 与 [SPEC-001](docs/specs/SPEC-001.md)，当前进度见 [PROGRESS.md](PROGRESS.md)。仓库仍在持续实现完整产品；健康页和基础登录通过不代表全部业务已经交付。

## 本地启动

前置条件：Docker Engine 与 Docker Compose。

```bash
scripts/docker-up.sh -d
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health/ready
```

打开 <http://127.0.0.1:3000>。默认 local-only 账号来自 `.env.example`：

- Candidate：`candidate@askme.local`
- Platform Admin：`admin@askme.local`

示例密码只用于绑定 loopback 的本地环境。需要修改时，在当前进程环境或 `~/.env` 设置 `ASKME_CANDIDATE_*`、`ASKME_ADMIN_*` 和 `ASKME_POSTGRES_*`；已存在账号不会被 bootstrap 自动改密。

## DeepSeek

默认模型为 `deepseek-v4-flash`，base URL 为 `https://api.deepseek.com`。`DEEPSEEK_API_KEY` 读取优先级为当前进程环境、当前用户 `~/.env`。真实 key 不得写入仓库。

```bash
npm run ai:check
```

该命令只输出安全状态、模型和耗时，不输出 key 或响应正文。

## 开发与验证

```bash
npm install
npm test
npm run lint
npm run typecheck
npm run build
npm run smoke:auth
```

运行 migration 和 bootstrap 需要 `DATABASE_URL` 及对应 local 账号环境变量。当前 Docker 操作事实、故障恢复和 Evidence 见 [OP-001](docs/operations/OP-001.md)。

## 数据保留

`docker compose stop` / `start` / `restart` 保留 PostgreSQL 和上传 volume。只有以下显式命令会删除 Askme 本地数据：

```bash
scripts/docker-reset.sh --confirm askme-local
```

不要把 reset 当作普通重启或故障恢复步骤。
