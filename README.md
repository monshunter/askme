# Askme

Askme 是个人职业知识库 Agent。Candidate 用真实职业资料建立 Career Knowledge Base，审核隐私边界并发布 Agent；Interviewer 通过 Chat 获得有来源依据的回答。

产品合同见 [SPEC.md](SPEC.md) 与 [SPEC-001](docs/specs/SPEC-001.md)，当前进度见 [PROGRESS.md](PROGRESS.md)。仓库仍在持续实现完整产品；健康页和基础登录通过不代表全部业务已经交付。

## 本地启动

前置条件：Docker Engine、Docker Compose、Node.js 22+，以及已经安装的项目依赖。完整环境包含 PostgreSQL、Web、普通 Worker、Mailpit 和宿主 Code Agent Runner；只启动 Compose 不足以消费 Repository Analysis。

```bash
scripts/docker-up.sh -d
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health/ready
```

`scripts/docker-up.sh -d` 会先启动 Compose，再以跨 Linux/macOS 的 `nohup scripts/agent-runner.sh &` 启动宿主 Runner。Runner 的 PID/lock 与日志位于已忽略的 `data/agent-runner/`；完整 readiness 必须同时看到 `codeAgent=ready`，以及 `runner`、`artifact`、`boxlite`、`provenance` 全部为 `ready`。可用以下命令检查后台日志：

```bash
tail -f data/agent-runner/nohup.log
```

Runner 默认全局并发为 3，调度时保留 1 个对话分析槽，因此最多同时执行 2 个仓库分析；仓库分析默认硬边界为 30 分钟、100 个模型轮次和 300 次工具调用。需要按机器容量调整时，在项目 `.env` 设置 `ASKME_CODE_AGENT_GLOBAL_CONCURRENCY`、`ASKME_CODE_AGENT_REPOSITORY_ANALYSIS_TIMEOUT_MS`、`ASKME_CODE_AGENT_MAX_ROUNDS` 或 `ASKME_CODE_AGENT_MAX_TOOL_CALLS`。

Runner 意外退出时无需重同步仓库或删除 pending run，直接手工恢复：

```bash
nohup scripts/agent-runner.sh >> data/agent-runner/nohup.log 2>&1 &
curl -fsS http://127.0.0.1:3000/api/health/ready
```

仅需 Compose、并明确接受 Code Agent degraded 时才使用：

```bash
ASKME_SKIP_AGENT_RUNNER=1 scripts/docker-up.sh -d
```

打开 <http://127.0.0.1:3000>；本地认证邮件可在 Mailpit <http://127.0.0.1:8025> 查看。默认 local-only 账号来自 `.env.example`：

- Candidate：`candidate@askme.local`
- Platform Admin：`admin@askme.local`

示例密码只用于绑定 loopback 的本地环境。需要修改时，在当前进程环境、项目 `.env` 或 `~/.env` 设置 `ASKME_CANDIDATE_*`、`ASKME_ADMIN_*` 和 `ASKME_POSTGRES_*`；优先级依次为当前进程、项目 `.env`、`~/.env`、本地默认值，已存在账号不会被 bootstrap 自动改密。

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
DATABASE_URL=postgresql://askme:askme-local-only@127.0.0.1:55432/askme npm run smoke:auth
```

运行 migration 和 bootstrap 需要 `DATABASE_URL` 及对应 local 账号环境变量。当前 Docker 操作事实、故障恢复和 Evidence 见 [OP-001](docs/operations/OP-001.md)。

## 数据保留

`docker compose stop` / `start` / `restart` 保留 PostgreSQL 和上传 volume。只有以下显式命令会删除 Askme 本地数据：

```bash
scripts/docker-reset.sh --confirm askme-local
```

不要把 reset 当作普通重启或故障恢复步骤。
