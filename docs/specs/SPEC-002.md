# SPEC-002：代码仓库知识与深度分析 V1 产品合同

Boundary ID：`askme-repository-code-agent-v1`

Owner boundary：Askme V1 的代码仓库同步、Repository Dossier、问答路由、深度源码分析、授权投影与验收行为。

Status：`approved`

唯一父 Plan：[PLAN-013](../plans/PLAN-013.md)

批准依据：[REVIEW-053](../reviews/REVIEW-053.md)

## 1. 目标与替代边界

Askme 允许 Candidate 将 GitHub 代码仓库的一个不可变 revision 转化为经过审核的结构化 Repository Dossier，并允许 Candidate 或已发布 Agent 的访问者在授权范围内获得带源码 Citation 的回答。普通问题优先使用文档与已批准 Dossier；只有需要核对原始代码的深度问题才启动受隔离、受预算约束的代码分析 Agent。

本合同是后续实现代码仓库能力的唯一产品事实 owner，并对 [SPEC-001](SPEC-001.md) 作如下定向替代：

- GitHub 仓库不再属于 `Source Material`，也不再生成 Source Material Chunk 或进入源码 RAG；
- `materials.kind` 只保留文件、Website 与 Notion 等文档型来源，Repository 使用独立领域模型；
- `SPEC-001` 中已完成的 GitHub Source Material 与 DeepSeek 专用配置验收只保留为历史交付事实，不约束新实现；
- 文件、Website、Notion、既有 Knowledge Item、发布、公共 Chat、四级可见性和 Admin 治理的其他行为继续由 `SPEC-001` 拥有。

Askme 尚处于开发阶段，本次不提供旧 GitHub material 数据的兼容、迁移或回填合同；具体实施可以重建本地开发数据，但任何真实破坏性操作仍需单独授权。

## 2. 角色与术语

### 2.1 角色

- **Candidate**：Repository、revision、Dossier 审核投影、公开能力开关与配额策略的 owner。
- **Interviewer / Visitor**：访问已发布 Candidate Agent 的匿名访客；只有 Candidate 开启仓库深度分析且当前权限与配额允许时，才可自动触发深度分析。
- **Platform Admin**：通过确定性管理页面、API、worker 和 controller 治理运行状态、配额与禁用策略；V1 不存在 Admin 专用的 System Operations Agent。

### 2.2 核心术语

- **Repository**：独立于 Source Material 的 GitHub.com 代码仓库记录。
- **Revision**：同步时由 ref 解析出的完整 Git commit SHA；成功同步后不可变。
- **Repository Artifact**：一个 Revision 经安全过滤和限额校验后的只读内容归档。
- **Repository Dossier**：Repository Analysis Run 对一个 Revision 生成的结构化事实索引与总结，不是源码副本，也不声称完成代码审计。
- **Generated Version**：Agent 生成且不可编辑的 claims、citations、coverage 与运行版本信息。
- **Approved Projection**：Candidate 在保留 Citation 约束的前提下编辑、隐藏并批准的公开文本投影。
- **Deep Analysis Run**：针对一个会话问题和一个 Revision 临时启动的源码分析任务。
- **Citation**：至少包含 repository、完整 commit SHA、path、line range 与内容 hash 的可验证源码引用。

## 3. V1 范围与非目标

V1 只支持 GitHub.com 的公开或私有仓库，通过 GitHub API 按完整 SHA 获取 archive。Candidate 必须显式发起首次同步或重新同步；Askme 不执行 webhook、短轮询、定时同步、后台自动跟随分支或实时 `git pull`。

V1 不支持 GitLab、Gitea、自托管 GitHub、SSH clone、submodule、Git LFS、跨仓库联合分析、源码写入、自动修复、Pull Request、代码执行、编译测试、浏览器、网络搜索、MCP 或 Candidate 提供的第三方 Skill。一个 Repository Analysis Run 或 Deep Analysis Run 只读取一个 Repository 的一个 Revision。

代码仓库始终只读。Askme、Pi、BoxLite guest 和模型均不得修改 Repository Artifact 或把修改回写到上游仓库。

## 4. Repository 同步与不可变 Revision

1. Candidate 提交 GitHub repository URL、branch/tag/SHA ref 和私有仓库需要的临时 Token；服务端解析并记录完整 SHA，再下载该 SHA 对应的 archive。
2. Token 只在当前同步请求的内存路径中使用，不进入数据库、Repository Artifact、日志、错误、环境文件、BoxLite 或持久凭证目录。重新同步私有仓库时 Candidate 必须重新提供 Token。
3. 同步必须先完成 archive 大小、解压大小、文件数、路径、文件类型和安全过滤校验；失败 revision 不可成为 active。
4. `private` Revision 通过 archive 校验后进入 `stored`，不启动 Agent，也不成为问答证据。`agent_only`、`citation_allowed` 或 `public_preview` 的新 Revision 依次经过 `staging → analyzing → review_pending → active`；任一步失败时保留旧 active Revision，新 Revision 只有 Dossier 生成成功且 Candidate 批准后才原子替换为 active。
5. 运行中的分析固定读取启动时绑定的 Revision。历史回答继续引用当时的完整 SHA；只要仍有消息 Citation 引用，物理 artifact 不得被垃圾回收。
6. 删除、撤销发布、账号暂停或权限降低必须立即使后续授权失败；物理 artifact 可以延迟 GC，但不能继续对用户可见。

默认过滤 `.git`、`node_modules`、`vendor`、`.next`、`dist`、`build`、`target`、`coverage`、`.cache`、`venv`、`.venv`、`__pycache__`、环境文件、密钥/凭证文件、二进制/NUL 文件、特殊文件、symlink、hardlink 与 device。默认保留源码、文档、manifest、lockfile、Docker、Kubernetes、Terraform、migration、测试和 `.github/workflows`。Candidate 可以在同步请求中增加排除规则，但 V1 不提供按文件 visibility。

默认输入上限如下，均允许由开发者配置收紧或放宽：

| 项目 | 默认上限 |
| --- | --- |
| 下载 archive | 100 MiB |
| 解压内容 | 500 MiB |
| 文件数 | 50,000 |
| 单个文本文件 | 2 MiB |
| path 长度 | 1,024 bytes |
| 单条 Citation | 200 lines |
| 文本编码 | UTF-8 |

## 5. Repository Dossier

每个允许 Agent 使用的新 Revision 必须先由 Repository Analysis Run 对原始 artifact 做一次有界深度分析，再生成持久 Dossier；`private` Revision 只存储 artifact，提升到可分析 visibility 时才开始该流程。Askme 不对源码创建 Chunk、embedding、向量索引、AST、call graph 或按语言适配的索引；Dossier 是代码仓库唯一持久语义索引。

Dossier 由结构化 claims 组成，至少支持以下类别：

- `overview`：项目目标、技术栈与主要入口；
- `implemented_behavior`：从当前代码可证明的已实现行为，不把推断伪装成产品 SPEC；
- `architecture`：主要组件、依赖方向和运行边界；
- `api`：可从源码证明的 API catalog；
- `module`：模块职责和导航索引；
- `data_security`：数据、身份、权限和 Secret 边界；
- `operations`：构建、配置、部署和观测入口；
- `limitation`：证据不足、未覆盖区域和已知限制。

每条 claim 保存 category、title、`statementMarkdown`、一至多个 Citation、visibility、状态和顺序。每条事实 claim 必须由当前 Revision 的有效 Citation 支撑；无法支撑的内容只能作为 limitation，不得批准为事实。

Generated Version 不可编辑，保存 Agent 原始 claims、citations、coverage、完整 SHA、artifact checksum、镜像 digest、Skill hash、prompt version、model profile 与实际 model。Candidate 通过独立 Approved Projection 编辑措辞、隐藏或降低可见性，但不能修改 Citation，也不能批准 Citation 无效的新增事实。审核动作保留审计事件。

生成后的 draft 可以在 Candidate preview 中显示 `pending review`；公共 Agent 只使用 Candidate 已批准的 Approved Projection。新 Revision 必须重新分析、重新审核；在新投影批准前，旧 active Revision 的已批准 Dossier 继续服务公共问答。

Dossier 必须记录 eligible file 总数、实际检查文件数与路径、覆盖类别、跳过原因，以及分析属于 targeted 或 broad。Candidate 可以查看 coverage；公共页面不必暴露内部检查清单。任何输出不得声称完成全仓库、全 API 或安全审计。

Repository Artifact、过滤规则或 Revision 变化必须生成新 Dossier。镜像、产品 Skill、system prompt 或 model profile 变化只将旧 Dossier 标记为 `analysis_outdated`，不使其自动失效，也不触发全量自动重跑；Candidate 或 Admin 可以对同一 Revision 发起重跑并重新审核。严重安全或正确性问题允许 Admin 通过确定性治理能力禁用相关 Dossier 或运行能力。

## 6. 文档检索与问答路由

Askme 的知识检索只保存和检索文档型资料、Knowledge Item 与已批准 Dossier，不保存或检索源码正文。V1 使用 PostgreSQL 结构化字段、全文搜索和必要的直接文档加载，不引入向量数据库。

每次问题按以下顺序决策：

1. 确定性门禁检查身份、publication、owner、Repository visibility、公开深度分析开关、问题范围、频率、并发和配额；任何 LLM 不能绕过这些门禁。
2. 在允许的文档、Knowledge Item 和 Approved Dossier 中进行初始检索。
3. 轻量 Router 输出 `rag`、`deep` 或 `refuse`，并附 reason、confidence 和唯一 repository id。低 confidence 先尝试普通回答；证据仍不足且门禁允许时才升级为 `deep`。
4. `rag` 使用检索到的文档或 Dossier 回答；`deep` 创建异步 Deep Analysis Run 读取绑定 Revision 的原始 artifact；`refuse` 返回明确边界说明。

一个问题涉及多个 Repository 且无法唯一确定目标时，Askme 必须请用户明确选择，不猜测、不并行启动多个 sandbox。公共访客只可看到当前 publication 允许展示的项目名称。

普通回答与深度回答都必须区分 `answered`、`insufficient` 与 `refused`。深度分析启动后如果失败，不得伪装成成功的 RAG fallback；系统应保留失败状态和安全重试入口。

## 7. 权限与 Citation 投影

Repository 的 visibility 在一个 Revision 内统一生效，沿用以下四级语义：

| Visibility | Repository Analysis / Dossier | Candidate Agent | 公共回答 | 公共 Citation |
| --- | --- | --- | --- | --- |
| `private` | 不启用 | 不可用 | 不可用 | 不可见 |
| `agent_only` | 可生成并审核 | 可使用 | 不可用 | 不可见 |
| `citation_allowed` | 可生成并审核 | 可使用 | 可使用 | 只显示允许的来源名称，不显示 commit、path、lines、snippet 或地址 |
| `public_preview` | 可生成并审核 | 可使用 | 可使用 | 可显示 commit、path、lines，并打开当前不可变源码视图 |

Pi 在 sandbox 内始终使用精确 repository、commit、path、lines 与 hash；最终 API 根据当前访问者权限重新投影。visibility 降低、publication 撤销或账号状态变化后，历史公共消息的 Citation 也必须按当前权限重新投影，不能依赖消息创建时的公开快照。

## 8. Deep Analysis Run 生命周期

每个 Deep Analysis Run 创建一个全新的临时 BoxLite microVM；生命周期按 run 而不是用户或会话划分，完成、失败或取消后必须清理，不跨 tenant 暖复用。基础镜像与只读缓存可以复用，但任何 guest 文件、凭证、上下文或进程不得跨 run 保留。

持久 run 状态至少包括 `pending`、`running`、`completed`、`failed`、`cancelled`，并与回答 outcome `answered`、`insufficient`、`refused` 分离。权限撤销、publication 失效或用户取消使仍未完成的 run 进入 `cancelled`；租约过期和 runner 中断由确定性 reconcile 恢复或终止。

最终用户问题、Assistant 最终消息、通过验证的 Citation 和最小 run metadata 可以持久化。模型中间 reasoning、工具逐步输出、临时文件和 guest 凭证不得持久化，也不得进入浏览器事件流、审计或日志。实时深度分析结论只属于当前会话，不写入 Dossier、Knowledge Item、RAG 或其他长期资料。

浏览器通过 SSE 观察 run。连接和重连先获得数据库当前快照，随后按单调 `analysis_runs.version` 接收状态事件；SSE 只推送 run id、version、状态和完成提示，客户端在完成后重新获取经过授权的最终资源。V1 不使用短轮询或 WebSocket，也不传输 reasoning、源码内容或 Secret。

## 9. AI Profile 与可配置性

V1 默认使用三个可独立配置的 Profile：

| Profile | 默认模型 | 默认模式 | 用途 |
| --- | --- | --- | --- |
| Router | `deepseek-v4-flash` | non-thinking | 问题复杂度与策略路由 |
| RAG Answer | `deepseek-v4-flash` | non-thinking | 文档与 Dossier 回答 |
| Code Agent | `deepseek-v4-pro` | thinking/high | Repository Analysis 与 Deep Analysis |

模型名、base URL、timeout、retry、token、thinking/reasoning 和 provider compatibility 选项必须能由配置或环境变量覆盖。Askme 只依赖开发者提供的 OpenAI-compatible Chat Completions endpoint 与 API key，不判断 endpoint 是原生模型厂商还是外部 AI Gateway，也不负责上游 API key 的签发和管理。

## 10. 配额、预算与失败反馈

公共访问者只有在 Candidate 开启公开深度分析且 publication、visibility、并发和配额均允许时，才可自动触发 Deep Analysis Run，不需要逐问题 Human Gate。V1 不提供计费系统，但必须支持 Candidate/publication/visitor、Repository 和全局多层配额。

Deep Analysis Run 默认预算：创建 microVM 30 秒、分析 120 秒、清理 30 秒；最多 10 个 LLM rounds、40 次工具调用、1 MiB 聚合工具输出、单次读取 64 KiB 或 500 lines、单次搜索 200 hits、最终回答 4,000 tokens；microVM 资源为 1 vCPU、1 GiB memory、2 GiB disk。默认并发为 visitor 1、publication 2、runner global 2。

Repository Analysis Run 与 Deep Analysis Run 使用同一隔离运行时，但前者默认最长 10 分钟且为低优先级，后者为高优先级；全局并发 2 时至少为实时 Deep Analysis 保留一个 slot。所有默认值允许开发者配置。

用户必须能区分等待、证据不足、拒绝、超时、上游 AI 失败、sandbox 失败、配额拒绝、取消和清理失败；服务端使用稳定错误码，不向 UI 暴露内部路径、Token、prompt、tool output 或 provider 原始敏感错误。

## 11. 安全不变量

1. Agent 只读取 Askme 已成功同步的不可变 Revision；sandbox 不持有 GitHub Token、Git credential 或 live repository access。
2. Candidate 仓库中的 `AGENTS.md`、`.agents/skills`、`.pi`、prompt 和其他指令文件只能作为待分析数据，不能改变 Pi system prompt、工具、Skill、模型、预算或安全策略。
3. Pi 只加载 Askme 随产品镜像发布的明确 Skill 和只读工具；V1 不提供 shell、write/edit、网络搜索、browser、MCP 或第三方 Skill。
4. API key 的正常路径是由 Host 在创建 run 时通过 Pi 内存运行时配置注入 guest；进程环境、临时文件或 Pi 持久凭证目录只能作为当前 microVM 内的备用路径，并随 microVM 销毁。Host 和 tenant 之间不得共享持久凭证目录。
5. 最终 Citation 必须在 Host 侧重新验证 Revision、path、line range、hash、排除规则和访问权限；首次无效时可在预算内要求一次修正，仍无效则 run 失败。

## 12. 验收基线

公共内容质量验收固定使用：

- Repository：`https://github.com/QuantumNous/new-api`
- Revision：`ccd535ef8e50cf6e5846a59278c40b7ff59d1b7d`

私有仓库安全验收固定使用：

- Repository：`https://github.com/monshunter/copybook`
- Revision：`10abc90f0d244485c0983a79f0c79238671bd3f0`
- Token：验收脚本优先读取进程环境 `ASKME_GITHUB_TEST_TOKEN`，缺失时只解析当前用户 `~/.env` 中同名键；不得 `source` 整个文件。Token 只作为一次性同步请求凭证提交给 Askme，不成为 Web、worker、runner 或 sandbox 的常驻配置。

任一固定 SHA 无法获取时，验收必须失败，不能静默切换为最新 `main`。Codex 在实施阶段从固定 public Revision 自行整理约 10 个基准问题，覆盖 Dossier/普通检索、必须深度分析、Router 边界、证据不足和权限投影；每题记录期望 route、关键事实和最低 Citation 条件，不要求答案逐字匹配，也不要求用户预先编写或逐题审核标准答案。

## 13. 验收标准

- [ ] `AC-REPO-001` GitHub.com 公开与私有 Repository 均能在显式同步时解析并固定完整 SHA，失败不会替换旧 active Revision。
- [ ] `AC-REPO-002` 私有 Token 只存在于一次同步请求内；数据库、artifact、日志、错误、BoxLite 和持久凭证目录均无 Token。
- [ ] `AC-REPO-003` archive 过滤、解压安全、路径与默认容量限制拒绝越界输入，artifact 保持只读且不包含被排除内容。
- [ ] `AC-DOSSIER-001` 每个可分析新 Revision 生成结构化 Dossier claims、有效源码 Citation 和诚实 coverage，不创建源码 Chunk、embedding、AST 或向量索引。
- [ ] `AC-DOSSIER-002` Generated Version 不可编辑；Candidate 只能通过 Approved Projection 编辑措辞、隐藏或降低可见性，且无效 Citation 或新增无证据事实不可批准。
- [ ] `AC-DOSSIER-003` 公共 Agent 只使用已批准投影，新 Revision 未批准时继续使用旧 active Revision；运行版本变化只标记 `analysis_outdated`。
- [ ] `AC-ROUTE-001` 确定性门禁先于 Router，Router 只能在 `rag`、`deep`、`refuse` 中选择且不能扩大 repository 或 visibility 权限。
- [ ] `AC-ROUTE-002` 普通文档/Dossier 问题不启动 sandbox；需要原始代码的问题在证据不足时升级为一个 Revision 的 Deep Analysis Run。
- [ ] `AC-ROUTE-003` 多 Repository 歧义要求用户选择，证据不足、拒绝和失败不伪装成成功回答或无提示 RAG fallback。
- [ ] `AC-RUN-001` 每个深度 run 使用新的临时 BoxLite microVM，guest 状态、进程和凭证在结束后销毁且不跨 tenant 复用。
- [ ] `AC-RUN-002` Pi 只加载 Askme 产品 Skill 和只读工具，Repository 中的指令文件无法改变运行时行为，代码仓库无法被写入。
- [ ] `AC-RUN-003` Host 对最终结构、Citation、预算、权限和清理结果完成确定性校验；无效 Citation 修正一次后仍失败则不发布答案。
- [ ] `AC-ASYNC-001` SSE 基于数据库 version 快照和事件恢复 pending/running/终态，不使用短轮询、WebSocket，也不泄露 reasoning、源码或 Secret。
- [ ] `AC-PRIV-004` 四级 Repository visibility 同时约束 Dossier、Candidate/Public 回答和 Citation 投影；降权与撤销立即作用于历史公共消息。
- [ ] `AC-AI-002` Router、RAG Answer 与 Code Agent Profile 可独立配置，默认模型符合合同，并可通过通用 OpenAI-compatible Chat Completions endpoint 工作。
- [ ] `AC-COST-001` 超时、round、工具、输出、读取、搜索、token、microVM 资源、并发和多层配额均由服务端强制，公共自动深度分析不能绕过。
- [ ] `AC-HISTORY-001` 最终会话消息、有效 Citation 和最小 run metadata 可恢复；中间 reasoning/tool output 不持久化，深度结论不进入 Dossier、RAG 或 Knowledge Item。
- [ ] `AC-ACCEPT-001` 固定 `new-api` Revision 完成约 10 题路由、事实与 Citation 验收，固定 private Revision 完成一次性 Token、不可变 SHA、撤权和清理验收。

## 14. 已批准的后续延迟项

以下内容不阻塞 V1，只有出现真实需要时才重新决策：独立 AI processing consent 记录、对象存储、多 Web 实例事件分发、向量检索、跨仓库分析、按文件 visibility、其他 Git provider、计费、warm sandbox 和代码写入能力。
