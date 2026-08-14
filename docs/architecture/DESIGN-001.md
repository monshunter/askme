# DESIGN-001：Askme MVP 全栈系统设计

Boundary ID：`askme-mvp-system`

Owner boundary：Askme MVP 的全栈组件、数据、接口、状态、部署与恢复架构。

Status：`active`

唯一父 Plan：[PLAN-001](../plans/PLAN-001.md)
行为合同：[SPEC-001](../specs/SPEC-001.md)

## 1. 目标、边界与不变量

本设计在单机 Docker 边界内交付真实的 Candidate 资料 → 知识库 → 隐私审核 → Agent → 发布 → Interviewer 对话闭环，并提供 Platform Admin 治理。系统可以在没有 DeepSeek key 时启动和管理资料，但不得把 AI 整理或回答标记为成功。

不变量：

1. Source Material、Knowledge Item、Chunk、预览会话和设置始终由 `owner_id` 隔离。
2. 任何发送给 AI 的上下文都先经过 owner 和 visibility 过滤；AI 不能扩大访问权限。
3. Citation 必须引用当前数据库中实际参与本次回答的 Chunk；内部上传路径和私有原文不进入公共响应，公开来源文件只能通过每次重新授权的 Route Handler 访问。
4. 数据库是业务状态唯一事实源；浏览器状态、设计稿示例、后台进程内存和日志均不能替代它。
5. Secret 只存在于服务端进程环境或当前用户 `~/.env`，不持久化到业务表和客户端。
6. Docker restart 保留 PostgreSQL 与上传文件；只有显式 reset 可删除本地数据。
7. Candidate 身份由服务端 session owner；Browser Visitor Identity 由同源 localStorage 的高熵 bearer credential owner，数据库与日志只接触其 hash。公开会话读写以 `publication + visitor hash + conversation id` 三重限定，conversation id 只是 selector，不能单独授权。

## 2. 系统上下文

```mermaid
flowchart LR
  C["Candidate browser"] --> W["Askme Web"]
  I["Interviewer browser"] --> W
  A["Platform Admin browser"] --> W
  W --> P[("PostgreSQL")]
  W --> F[("Upload volume")]
  W --> E["GitHub / Notion / Website"]
  W --> D["DeepSeek Chat Completions"]
  R["Ingestion worker"] --> P
  R --> F
  R --> E
  R --> D
```

### 2.1 组件职责

| 组件 | 单一职责 |
| --- | --- |
| Web | SSR 页面、JSON API、身份会话、owner/role 授权、上传接收、公开 Chat 与 Admin 查询 |
| Worker | 原子领取 ingestion job，从本地上传或远端快照提取/切分资料，调用 AI 整理，事务性写入派生知识 |
| PostgreSQL | 用户、业务状态、全文检索、job 队列、会话、Citation、审计与聚合事实源 |
| Upload volume | 保存 owner 隔离的原始上传文件；只由 Web/Worker 服务端读取，浏览器仅通过授权 Route Handler 获得响应内容 |
| DeepSeek adapter | 统一超时、错误映射、JSON 解析、Chat 生成和 Secret 边界 |
| External source adapters | 请求内完成 GitHub、Notion 与 Website 的安全获取、校验、限额，并写入不含凭证的规范化快照 |

Web 和 Worker 共享同一 TypeScript domain/service 层，UI 不直接访问数据库。没有独立微服务、缓存、对象存储、向量数据库或消息中间件；这些能力在单机 MVP 中没有独立价值。

## 3. 技术组织

- Next.js App Router + React + TypeScript 提供 Web、Route Handlers 和服务端渲染。
- PostgreSQL 提供事务、`FOR UPDATE SKIP LOCKED` job 领取、关系约束和 `tsvector`/`ts_rank_cd` 全文检索。
- Drizzle ORM 管理类型化查询；版本化 SQL migration 保留数据库变更事实。
- Node.js 内置 `scrypt` 生成密码 hash；随机 Candidate session、密码重置和游客 token 均使用 CSPRNG，数据库只保存 token hash。Candidate session 与游客的同源同步 cookie 使用 HttpOnly、SameSite 与生产 Secure 属性。
- Vitest 覆盖 domain/unit，独立 PostgreSQL schema 覆盖 integration，Playwright 覆盖自动化 E2E；最终参考图验收使用用户指定 Chrome surface。
- UI 直接复用 `asserts/images/` 背景资产，以 CSS design tokens、共享 Shell 和语义组件实现 Candidate、Public 与 Admin 三种布局。

选择 PostgreSQL 全文检索而非向量数据库：DeepSeek 当前指定能力是文本生成而非 embedding；MVP 的资料规模可由标题、摘要和 Chunk 加权全文检索满足，且 Citation 可以精确回指命中 Chunk。若未来实测召回不足，可在不改变权限与 Citation 模型的前提下增加 embedding 列和检索器实现。

## 4. 数据模型

所有主键使用 UUID，时间统一保存 UTC。主要关系如下：

| 实体 | 关键字段与约束 |
| --- | --- |
| `users` | email unique、password hash、role(candidate/admin)、status、locale、公开 profile |
| `sessions` | token hash unique、user id、expires/revoked；删除/撤销立即失效 |
| `password_reset_tokens` | user、token hash unique、expires/used；新请求使旧 token 失效，成功消费后不可重放 |
| `auth_rate_limits` | email/IP hash scope、window、count；不保存原始邮箱、IP 或凭证 |
| `materials` | owner、kind、source locator、status、visibility、checksum、summary、错误与索引时间 |
| `ingestion_jobs` | material unique active job、state、attempt、lease、next run、last error |
| `chunks` | material/owner、position、content、search vector；material 删除级联 |
| `knowledge_items` | owner、type、title、summary、highlights、confidence、更新时间 |
| `knowledge_sources` | knowledge item 与 material 多对多，联合唯一 |
| `privacy_confirmations` | owner、policy revision、confirmed at；visibility 变化使旧确认失效 |
| `agent_settings` | owner unique、tone、public mode、privacy-safe mode、推荐问题配置 |
| `publications` | owner、unguessable slug unique、status、published/revoked/paused 时间 |
| `conversations` | owner、preview/public mode、publication、visitor token hash、rolling expires、last activity；public 允许同一 publication + visitor hash 对应多行，并以覆盖 list/switch 的复合索引查询 |
| `messages` | conversation、role、content、status、AI latency/model、error code |
| `message_citations` | assistant message、chunk、rank、公开 excerpt；联合唯一 |
| `answer_feedback` | message、actor/session、value，防止重复反馈 |
| `content_flags` | publication/message、category、severity、status、review decision |
| `audit_events` | actor/role、action、target type/id、outcome、safe metadata、created at |
| `ai_usage` | owner、purpose、model、token/latency、outcome，不保存 prompt 原文 |
| `platform_settings` | 非 Secret 策略键值、updated by/time |

数据库约束阻止跨 owner 派生关系：service 层所有查询显式携带 `owner_id`，integration test 使用第二 Candidate 证明隔离。Admin 聚合查询只选择允许字段，不复用 Candidate 私有详情查询。

## 5. 状态与流程

### 5.0 Candidate 认证与浏览器游客

Candidate 注册先规范化邮箱并以事务创建唯一 `candidate` 用户、默认 Agent/Privacy 状态和首个 session；注册路由不接收 role。登录复用相同邮箱规范化和密码校验。已登录改密先验证当前密码，再更新 hash、撤销全部旧 session 并签发当前请求的新 session。

忘记密码按邮箱/IP hash 限流，外部始终返回相同的“请求已受理、投递不保证”反馈；只有 active Candidate 才创建 30 分钟 token hash 并通过共享 SMTP transport 发送 path 参数形式的 `/reset-password/<token>` 链接。Admin invitation 与密码重置只各自拥有主题和正文模板，连接、认证、TLS、超时、关闭和安全错误映射由 `server/mail` 单一 owner 负责。两类模板通过 URL helper 从 `ASKME_PUBLIC_BASE_URL` 构造绝对地址，不读取请求 Host；解析器把合法 HTTP(S) 根地址规范化为带尾部 `/` 的 canonical URL，默认使用 `https://askme.monshunter.xyz/`。新请求原子失效旧 token；重置在锁定 token/user 后一次消费、更新密码并撤销全部 session。SMTP 整体未配置时在查询账号前返回安全能力错误；单封密码重置邮件发送失败时失效本次 token、记录不含身份和 token 的失败审计，并保持统一已受理反馈，避免用投递结果枚举账号。

公共页客户端读取 `askme.publicVisitor.v1`；不存在时由 singular session bootstrap endpoint 签发 32-byte token，响应后先写 localStorage，再加载该 publication 的 Conversation 列表。后续请求用 `X-Askme-Visitor-Token` 发送同一 token，bootstrap endpoint 同步一个全局 HttpOnly cookie 给 EventSource、来源预览和普通新标签请求；初始化时 header 是身份 owner，header 缺失表示创建新身份，只有升级前的 slug cookie 可被一次性桥接并清除。bootstrap 在事务级 advisory lock 内恢复最近活动 Conversation，不存在时只创建一个，显式 plural sessions POST 才无条件新建。

Session service 以 `publication + visitor hash` 列出最近活动会话，并从每个 Conversation 的首条 user message 投影最多 80 个字符的标题；空会话标题由 UI 按 locale 提供，不新增可漂移的 title 列。Chat、suggestion、feedback、run 与 source 路由必须携带或从目标资源解析 conversation id，再以三重条件重新授权。删除在事务中锁定目标 Conversation；存在 `pending/running` Analysis Run 时返回 `PUBLIC_SESSION_BUSY`，否则依靠外键级联删除消息、Citation、反馈与已结束 Run并记录安全审计。

每个 Public Conversation 使用 30 天无活动滚动期限；有效访问只更新目标会话的 last activity/expiry。localStorage 清除后初始化不会从全局 cookie 恢复旧身份，而是覆盖为新 token；复制 localStorage token 等价于复制 bearer credential，是客户端应保护的身份边界。`0020` migration 只移除旧唯一索引并增加 list/switch 复合索引，不重写或删除既有 Conversation，因此回滚应用版本时必须保持能理解一对多模型。

### 5.1 资料处理

```text
upload → material(queued) + job(queued)
connect(token stays in request) → validate/fetch → normalized snapshot → material(queued) + job(queued)
worker lease → processing
read local file/snapshot → validate → extract → chunk → AI organize
transaction replace derived rows → indexed
recoverable failure → queued(next_run, attempt+1)
terminal/config/input failure → failed(error_code)
manual retry → new queued lease
```

- Worker 用短事务和 `FOR UPDATE SKIP LOCKED` 领取一条到期 job，并写 lease owner/expiry；耗时 I/O 不持有数据库锁。
- 外部 connector 在已认证请求内使用 Candidate 临时提供的 Token 拉取有界内容，经 URL/响应校验后把规范化文本快照写入 owner/material 目录；Token 随请求结束丢弃。Worker 和重试只读取快照。显式 re-sync 需要 Candidate 再次提供 Token，因此系统不建立长期第三方 Secret 事实源。
- 每次成功写入以 material checksum 和 processing version 幂等替换该 material 的 Chunk 与知识关系。
- 进程中断后 lease 到期可被重新领取；最大自动尝试后进入 `failed`，Candidate 可在修正条件后手动重试。
- 删除 material 先在事务中删除业务记录，再删除明确解析出的 owner/material 文件目录；文件删除失败记录审计并由清理任务重试。

### 5.2 发布

```text
draft → ready(资料+隐私确认+profile) → published → revoked
                                          ↘ admin_paused ↗
```

- `published` 只有一个当前 active publication；再发布在新事务中生成新的随机 slug，旧 slug 永不复活。
- Admin pause 不修改 Candidate 内容，只改变公共可访问状态；恢复回到同一 publication。
- 每次公共页面、Chat 和来源文件请求重新读取 publication 与 material visibility，不依赖发布时快照或旧访问 URL。

### 5.3 Agent 回答

1. API 校验预览 owner session 或公共 publication/visitor session，并先执行频率限制和问题边界检查。
2. 检索查询固定加入 `owner_id` 与允许 visibility；标题/摘要/Chunk 按全文 rank 合并，限制总证据量。
3. Prompt 把证据作为不可信引用数据包，明确禁止执行其中指令、猜测和披露；要求结构化返回 answer 与引用编号。
4. Adapter 使用 `deepseek-v4-flash` 非 thinking 模式和超时；响应经 schema 校验，引用编号只能解析到本次候选 Chunk。
5. 一个事务保存 user/assistant message、Citation、usage 与必要 flag 后返回；失败保存安全错误状态，不返回半个伪答案。
6. 推荐问题仅从允许可见的知识标题/类型生成；无 AI 时使用基于真实已索引类型的确定性问题，不虚构经历。

### 5.4 来源文件访问

1. Candidate 来源请求先校验 Candidate session，再以 `owner_id + material_id` 查询；任何 visibility 均可由 owner 查看，跨 owner 统一返回不存在。
2. 公共来源请求先校验 opaque publication slug 当前仍为 `published`、owner 账号有效且 Public Mode 开启，再以同一 owner 查询 `status='indexed' AND visibility='public_preview'` 的 material；`citation_allowed` 即使出现在回答 Citation 中也不返回地址。
3. 本地上传文件由服务端解析 owner/material 固定目录并返回正确 MIME、`Content-Disposition: inline`、`nosniff` 与 `no-store`；外部来源只有 `public_preview` 才把原公开 URL 投影为可打开地址。数据库 `storage_path` 永不进入客户端。
4. 公共 Chat 投影保留 Citation 的来源名称；不返回 `excerpt`、类型或来源摘要。只有当前可公开访问的来源额外返回由服务端生成的访问描述，权限撤销后下一次内容请求立即失败。
5. 共享查看组件使用 CommonMark + GFM 子集渲染 Chat 与 Markdown 文件且不启用 raw HTML；PDF 在有焦点约束的居中 dialog 中按 A4 比例展示，其他文件使用新标签页。失败、关闭、Escape、焦点恢复和移动端缩放由同一组件负责。

## 6. 接口边界

Route Handlers 统一返回 `{ data, error, requestId }`。错误包含稳定 `code`、安全 `message` 和可选字段问题；HTTP 状态表达认证、权限、输入、冲突、限流和上游失败。

主要资源边界：

- `/api/auth/*`：register、login、logout、current session、forgot/reset password 与 authenticated password change。
- `/api/materials/*`：列表、文件/connector 创建、状态、retry、delete；`GET /api/materials/[materialId]/content` 提供 Candidate owner 范围的文件内容访问。
- `/api/knowledge/*`：分类/搜索/分页、详情和允许字段编辑。
- `/api/privacy/*`：visibility 修改、预览和确认。
- `/api/agent/*`：设置、推荐问题和 Candidate preview conversation/chat/feedback。
- `/api/publications/*`：供 Candidate Agent 页面使用的 readiness、generate、publish 与 revoke；公共投影继续由公共 Agent service 按公开权限读取。
- `/api/public/agents/[slug]/*`：公开 profile；singular `session` 负责身份 bootstrap 与最近会话恢复，plural `sessions` 负责列表/新建，`sessions/[conversationId]` 负责删除；chat/suggestion/feedback/run/source 在 visitor credential 之外携带 conversation id。`GET /api/public/agents/[slug]/materials/[materialId]` 提供 `public_preview` 来源内容访问。
- `/api/admin/*`：overview、candidates、agents、reports、review、settings 和治理动作。
- `/api/health/live` 只证明进程；`/api/health/ready` 检查数据库、migration、worker heartbeat 和 AI 配置状态并分别报告。

变更接口验证同源请求和 JSON/form schema。文件上传不接受客户端路径，服务端重新生成存储名并验证签名/MIME/大小。外部 URL 只允许 http/https，阻止 loopback、link-local、私网解析和重定向到内网，避免 SSRF。

## 7. 配置与 Secret

优先级：显式进程环境 > 当前用户 `~/.env` > 非 Secret 默认值。解析器只读取允许键，不把整个文件注入环境。

| 配置 | 默认/要求 |
| --- | --- |
| `DATABASE_URL` | Docker 内指向 PostgreSQL；进程必须显式获得 |
| `UPLOAD_ROOT` | `/data/uploads`（Docker volume） |
| `ASKME_PUBLIC_BASE_URL` | 邮件站内链接的公开 HTTP(S) 根地址，默认 `https://askme.monshunter.xyz/` |
| `DEEPSEEK_API_KEY` | 可缺省启动；AI 操作返回 `AI_NOT_CONFIGURED` |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` |
| `ASKME_CANDIDATE_*` / `ASKME_ADMIN_*` | migration/bootstrap 创建或更新本地初始账号，不覆盖已有密码除非显式 rotate |
| `ASKME_SMTP_*` | Host/port/secure/from 与可选成对 user/password；本地 Compose 默认指向 Mailpit，生产必须显式配置真实 SMTP |

Docker wrapper 在宿主进程加载 `~/.env` 的 allowlist 后调用 Compose；Compose 只传递所需变量。官方 DeepSeek 文档确认 OpenAI-compatible base URL 和模型标识：[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)、[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion)。

## 8. UI 结构

### Candidate Shell

固定桌面侧栏包含 Dashboard、Upload Materials、Knowledge Base、Privacy Control 和唯一的 Agent / 智能体入口；顶部只保留通知和账号菜单，不再提供页眉搜索或快捷操作。账号菜单提供账号安全与注销，账号安全页只承载当前密码验证和改密；注册、忘记密码与重置密码使用独立认证壳层。根布局在登录前后所有路由的右上角提供唯一语言设置，各 Shell 与页面 footer 不再渲染语言入口。Candidate Shell 不再持有 Quick Action、邀请面试官或独立 Publish Agent 导航。移动端变为可关闭 drawer，主内容使用单列卡片。

`/workspace/agent` 的 Server Component 并行加载预览对话、Agent settings 与 publication overview；页面内部把预览问答、设置、发布 readiness、链接、发布/撤销和已发布公共页入口组成同一 Candidate Agent 工作流。`/workspace/publish`、`/workspace/publish/preview`、专用页面组件与 `GET /api/publications/preview` 退役；publication domain service 以及 current/link/publish/revoke API 继续作为 Agent 页与公共访问链路共享的服务端边界。

### Public Agent

独立公共壳层：左侧保留 Candidate 授权 profile/Agent 状态和分享入口，并增加会话管理卡片；卡片顶部是明确的新增按钮，下方按最近活动显示当前游客的标题、时间、选中态和逐项删除操作。中央 Markdown Chat 与只显示来源名称的 Citation，右侧 highlights/recommendations；`public_preview` 来源名称可打开，其他 Citation 保持无地址文本。新增先持久化空 Conversation 再切换；删除成功后选择下一最近会话，无剩余项时创建空会话；切换期间保留明确 loading/failed/ready 状态，不把旧消息显示在新会话下。

客户端在 Chat 初始化前建立 Browser Visitor Identity，所有 fetch 显式携带 token 和当前 conversation id，EventSource 与普通来源链接使用同步 cookie 并在 URL 中携带 conversation id。桌面会话栏位于左侧 Candidate 信息下方且不挤压 Chat；窄屏按 profile 摘要 → 会话管理 → Chat → Citation/highlights 排列，会话列表自身有界滚动，页面无横向溢出，输入固定在可见内容流末端而不遮挡正文。

### Platform Admin

独立 Admin 侧栏和身份标签；页眉不显示全局搜索或 Quick Action，Overview 内容区仍使用指标、最近发布、review 队列、趋势和真实 quick actions。子页面复用统一表格/筛选/空态与各自领域搜索，不显示 Candidate 私有原文。

三种 Shell 共享 design tokens、纸张纹理、墨绿色和水墨资产，但路由、角色标识和数据权限不共享。English/简体中文字典在服务端选择首屏语言，客户端切换写用户设置或匿名 cookie，避免 hydration 混用。

## 9. 失败、观测与恢复

- 数据库不可用：ready fail，写入拒绝；live 保持以便查看诊断。
- Worker 停止：ready 标记 degraded，queued job 保留；重启后继续领取。
- DeepSeek 未配置/401/429/timeout/invalid response：映射独立错误码，保存 usage outcome，UI 可重试；资料原文与已索引状态不丢失。
- 外部 connector 401/403/404/429/timeout/SSRF：保存安全错误和 retry eligibility；凭证不入错误文本。
- migration 失败：Web/Worker 不进入 ready；先修 migration，不自动降级旧 schema。
- 文件与数据库不一致：定期 cleanup 只处理数据库已不存在且明确位于 upload root 下的孤儿；禁止宽范围递归删除。
- 来源内容请求期间权限、publication 或文件状态变化：每个请求重新查询；不缓存授权决定，返回不存在且不暴露先前状态。Markdown 加载或 PDF 浏览器预览失败只影响当前 dialog，可关闭后重试或按允许格式在新标签页访问。
- SMTP 未配置：忘记密码在账号查询前返回明确的暂不可发送能力错误；单封投递失败时统一返回已受理、失效本次 token 并记录安全审计，不以投递差异泄露账号存在性。已签发 token 不记录明文，恢复 SMTP 后重新请求即可替代旧 token。`ASKME_PUBLIC_BASE_URL` 非法时配置加载失败，不回退到请求 Host。
- 游客 localStorage 不可用或 token 非法：公共页面显示可重试的 session 初始化失败，不回退到共享 Conversation；过期 Conversation 从列表消失，同一游客没有活动会话时建立新 Conversation。删除正在运行 Deep Analysis 的会话返回可读冲突，运行结束后可重试。

结构化日志字段包含 timestamp、level、service、request/job id、action、outcome、safe error code；敏感 headers、cookie、密码、token、AI prompt、Chunk 原文和完整文件内容默认不记录。

## 10. 本地部署、迁移与回滚

Compose 包含 `db`、一次性 `migrate`、`web`、`worker` 和本地 `mailpit`。`web`/`worker` 等待 migration 成功；db/upload 使用命名 volume，Mailpit 只保存本次本地验收邮件。`scripts/docker-up.sh` 负责 allowlist 配置加载，`docker compose stop/start` 保留业务数据，`scripts/docker-reset.sh` 是唯一显式清空入口并在执行前显示目标 volume。

应用 migration 只向前执行并记录版本。当前空仓库没有旧数据迁移；每个后续 schema 变更必须提供兼容顺序。代码回滚只允许回到能理解当前 schema 的 revision；若 migration 不可向后兼容，先恢复数据库备份或编写显式修复 migration，不自动删除列/数据。

## 11. 验证策略

1. Domain/unit：password/session/reset token、邮箱规范化、认证限流、公开 base URL 解析与两类邮件 path、游客 token/localStorage contract、visibility matrix、公开文件访问矩阵、Markdown 安全渲染、config allowlist、URL 安全、retrieval filter、状态机与 AI response parser。
2. PostgreSQL integration：migration、注册唯一性、重置单次消费、session 撤销、同一 Visitor 多 Conversation 的列表/新建/切换/删除、双 Visitor 与双 publication 隔离、Deep 运行中删除冲突、job lease/idempotency、级联删除、全文检索、发布/撤销与 Admin 聚合。
3. Adapter contract：真实样例文件、受控 GitHub/Notion/Website HTTP fixture、DeepSeek mock 与一次不记录响应正文的真实 health/chat smoke。
4. Docker：空 volume 启动、健康、bootstrap、worker job、restart 持久性和显式 reset 目标审计。
5. Browser：Candidate 注册/登录/注销/忘记/重置/改密、两个独立 localStorage 游客的 Markdown 对话与互相不可见、同一游客新增/切换/刷新恢复/删除多个会话、Candidate/Public 来源预览、Admin 治理、错误/空/处理中状态、1448 × 1086 截图对照、430 × 932 overflow/a11y；最后用真实浏览器重跑核心场景。

每个 `SPEC-001` AC 必须在 Review/Scenario/Operation owner 中指向当前 Evidence 后才可勾选；窄测试不能替代跨角色或真实浏览器结论。
