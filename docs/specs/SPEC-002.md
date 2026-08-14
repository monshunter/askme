# SPEC-002：代码仓库 Wiki 与深度分析 V1 产品合同

Boundary ID：`askme-repository-code-agent-v1`

Owner boundary：Askme V1 的代码仓库同步、Repository Wiki、问答路由、深度源码分析、授权投影与验收行为。

Status：`approved`

创建 Plan：[PLAN-014](../plans/PLAN-014.md)；当前修订 Plan：[PLAN-016](../plans/PLAN-016.md)

批准依据：[REVIEW-072](../reviews/REVIEW-072.md)

## 1. 目标与替代边界

Askme 允许 Candidate 将 GitHub 代码仓库的一个不可变 revision 转化为一组经过审核、可直接阅读和导出的 Repository Wiki Markdown 文档，并允许 Candidate 或已发布 Agent 的访问者在授权范围内获得带源码 Citation 的回答。小型或单一主题仓库可以只生成一个 Markdown；大型或多子系统仓库由分析 Agent 按内容结构生成多个有导航关系的 Markdown。Wiki 的首要价值是帮助读者建立对整个仓库的系统心智模型，而不是罗列少量“当前代码写了什么”的离散事实。普通问题优先使用文档与已批准 Wiki；只有需要核对 Wiki 未覆盖的原始代码时才启动受隔离、受预算约束的代码分析 Agent。

本合同是后续实现代码仓库能力的唯一产品事实 owner，并对 [SPEC-001](SPEC-001.md) 作如下定向替代：

- GitHub 仓库不再属于 `Source Material`，也不再生成 Source Material Chunk 或进入源码 RAG；
- `materials.kind` 只保留文件、Website 与 Notion 等文档型来源，Repository 使用独立领域模型；
- `SPEC-001` 中已完成的 GitHub Source Material 与 DeepSeek 专用配置验收只保留为历史交付事实，不约束新实现；
- 文件、Website、Notion、既有 Knowledge Item、发布、公共 Chat、四级可见性和 Admin 治理的其他行为继续由 `SPEC-001` 拥有。

Askme 尚处于开发阶段，本次不提供旧 GitHub material 数据的兼容、迁移或回填合同；具体实施可以重建本地开发数据，但任何真实破坏性操作仍需单独授权。

## 2. 角色与术语

### 2.1 角色

- **Candidate**：Repository、revision、Wiki 审核投影、公开能力开关与配额策略的 owner。
- **Interviewer / Visitor**：访问已发布 Candidate Agent 的匿名访客；只有 Candidate 开启仓库深度分析且当前权限与配额允许时，才可自动触发深度分析。
- **Platform Admin**：通过确定性管理页面、API、worker 和 controller 治理运行状态、配额与禁用策略；V1 不存在 Admin 专用的 System Operations Agent。

### 2.2 核心术语

- **Repository**：独立于 Source Material 的 GitHub.com 代码仓库记录。
- **Revision**：同步时由 ref 解析出的完整 Git commit SHA；成功同步后不可变。
- **Repository Artifact**：一个 Revision 经安全过滤和限额校验后的只读内容归档。
- **Repository Wiki**：Repository Analysis Run 对一个 Revision 生成的 1–N 个 Markdown 仓库理解文档与导航 manifest，包含架构与模块关系、关键工作流、运行方式、扩展点、限制、Mermaid 图和可验证源码 Citation；不是源码副本，也不声称完成代码审计。
- **Generated Version**：Agent 在隔离输出目录写入且不可编辑的原始 Wiki Markdown 文件、导航 manifest、结构化 Citation、coverage 与运行版本信息。
- **Approved Projection**：Candidate 审核并批准的 Wiki 文档投影；V1 允许逐文档编辑 Markdown，但不能修改或伪造 Host 验证的 Citation 目标，也不能提升 Repository visibility。
- **Deep Analysis Run**：针对一个会话问题和一个 Revision 临时启动的源码分析任务。
- **Citation**：至少包含 repository、完整 commit SHA、path、line range 与内容 hash 的可验证源码引用。

## 3. V1 范围与非目标

V1 只支持 GitHub.com 的公开或私有仓库，通过 GitHub API 按完整 SHA 获取 archive。Candidate 必须显式发起首次同步或重新同步；Askme 不执行 webhook、短轮询、定时同步、后台自动跟随分支或实时 `git pull`。

V1 不支持 GitLab、Gitea、自托管 GitHub、SSH clone、submodule、Git LFS、跨仓库联合分析、源码写入、自动修复、Pull Request、代码执行、编译测试、浏览器、网络搜索、MCP 或 Candidate 提供的第三方 Skill。一个 Repository Analysis Run 或 Deep Analysis Run 只读取一个 Repository 的一个 Revision。

代码仓库始终只读。Askme、Pi、BoxLite guest 和模型均不得修改 Repository Artifact 或把修改回写到上游仓库。

## 4. Repository 同步与不可变 Revision

Candidate 的代码仓库页面以卡片目录罗列所有已添加 Repository，并在“已添加仓库”标题右侧提供唯一的“+ 添加仓库”入口；页面主体不平铺新增表单，也不提供目录级手动刷新按钮。Candidate 点击该入口后，才在模态弹窗中填写首次同步表单；重新同步与重新分析仍是各 Repository 卡片内的独立动作。

1. Candidate 提交 GitHub repository URL、branch/tag/SHA ref 和私有仓库需要的临时 Token；服务端解析并记录完整 SHA，再下载该 SHA 对应的 archive。
2. Token 只在当前同步请求的内存路径中使用，不进入数据库、Repository Artifact、日志、错误、环境文件、BoxLite 或持久凭证目录。重新同步私有仓库时 Candidate 必须重新提供 Token。
3. 同步必须先完成 archive 大小、解压大小、文件数、路径、文件类型和安全过滤校验；失败 revision 不可成为 active。
4. `private` Revision 通过 archive 校验后进入 `stored`，不启动 Agent，也不成为问答证据。`agent_only`、`citation_allowed` 或 `public_preview` 的新 Revision 依次经过 `staging → analyzing → review_pending → active`；任一步失败时保留旧 active Revision，新 Revision 只有 Wiki 生成成功且 Candidate 批准后才原子替换为 active。
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

## 5. Repository Wiki

每个允许 Agent 使用的新 Revision 必须先由 Repository Analysis Run 对原始 artifact 做一次有界但面向全仓库理解的深度分析，再生成持久 Wiki；`private` Revision 只存储 artifact，提升到可分析 visibility 时才开始该流程。Askme 不对源码创建 Chunk、embedding、向量索引、AST、call graph 或按语言适配的索引；Approved Wiki 是代码仓库唯一持久语义索引。

Repository Analysis 必须先盘点目录、语言、manifest、入口、配置、测试与运维文件，再识别主要子系统并为每个主要子系统检查代表性实现。不能在只读 README、入口文件和少量 router 后就结束，也不能把固定 4–6 条 Claim 当作 Wiki。对大型仓库允许抽样，但必须以架构边界和关键工作流为抽样单位；报告要明确未深入区域，不能把“检查了若干文件”表述成全仓库覆盖。

最终产物是一个由 1–N 个 `.md` 文件组成的自包含 Wiki bundle。Agent 根据仓库规模和内容边界决定单文档或多文档：一个主题可以保持单文件，多个主要子系统、独立工作流或明显的运维/扩展边界应拆成有序页面；不能按固定模板机械拆页，也不能把本应连续的短段落切成大量空洞页面。整个 bundle 至少具备以下阅读结构；不适用的章节可以合并，但不能用空标题或空页面凑数：

1. 项目定位、目标用户、核心能力和技术栈；
2. 一张帮助读者建立心智模型的 Mermaid 架构或关键流程图；
3. 仓库结构与主要模块地图，说明职责、依赖方向和入口；
4. 至少两个从入口到关键副作用或输出的端到端工作流；
5. 外部接口、数据与状态、安全/权限边界；
6. 配置、构建、测试、部署、运行和观测方式；
7. 扩展点、维护导航、已知限制、证据不足和未覆盖区域；
8. Host 验证的源码引用索引。

Wiki 必须解释组件为什么存在、如何协作、请求或数据如何流动、读者应从哪里开始继续阅读；只罗列文件名、接口名或局部实现事实不满足完成条件。每个页面必须有唯一相对 path、标题、导航顺序和至少一个实质章节；跨页链接只能指向当前 bundle 中声明的 Markdown path。Markdown 可以包含表格、列表、代码标识和 Mermaid，但不能包含可执行 HTML、外部脚本、Secret、模型 reasoning 或工具逐步输出。

Pi 只通过 Askme 提供的受限 Wiki writer 向 `/workspace/output/wiki/` 写入 Markdown；Repository Artifact 挂载点继续只读。最终 stdout/control envelope 只返回 `title`、`summary`、页面 manifest、结构化 `citations` 与 `coverage`，不重复携带完整 Markdown。Host Controller 在销毁 microVM 前通过 BoxLite `copyOut` 取回该输出目录，然后只接受 manifest 声明的普通 `.md` 文件；symlink、路径逃逸、隐藏文件、非 UTF-8、未声明文件、文件数/单文件/总大小越界均拒绝。

每个 Markdown 正文通过稳定标记 `[S1]`、`[S2]` 引用结构化 Citation；每个事实章节至少引用一个当前 Revision 的有效 Citation，所有正文标记必须唯一映射到一个页面和源码范围，未定义标记拒绝。同一已验证 Citation 被多个页面复用时，Host 为各页面确定性分配独立 marker，不改变其 path、range 或 hash；模型额外返回但正文未使用的 Citation 不进入 Generated Version，由 Host 在验证和持久化前确定性剔除。Host 在发布或导出时生成可读的源码引用列表，Citation 至少固定完整 SHA、path、line range 与内容 hash。

Generated Version 不可编辑，保存 Agent 原始页面文件、导航 manifest、citations、coverage、完整 SHA、artifact checksum、镜像 digest、Skill hash、prompt version、model profile 与实际 model。Candidate 通过独立 Approved Projection 逐页审核 Markdown；编辑后的投影不得增加未被 Generated Version 引用的 `[S*]` 标记、删除所有限制说明、嵌入危险 HTML、制造 bundle 外链接或绕过 Repository visibility。审核动作保留审计事件。

Candidate 批准 Approved Projection 后，该 Wiki 与状态为 `indexed` 的上传文件、Website、Notion 资料处于同一知识来源层：统一 EvidenceProvider 可以同时检索两者，Candidate Preview 与已发布 Public Chat 都从同一授权 evidence packet 回答并持久化 Citation。区别只在来源投影：资料 Citation 指向 Material/Chunk，Wiki Citation 指向 Approved Wiki section 及其不可变 Repository source range。未审核的 Generated Wiki、原始源码正文和实时 Deep Analysis 结果都不得进入这条长期知识检索链路。

职业知识库页面必须投影同一个长期知识来源层，不能只展示 `knowledge_items`。每个具有 current active Revision 与 Approved Projection 的 Repository 在“代码仓库”分类中显示为一条只读知识条目，条目详情在同一 Repository 下展示其 1–N 个 Wiki 页面、当前完整 SHA、visibility、coverage 与源码 Citation；分类和“全部”计数按 Repository 条目计数，不按 Wiki 页面数膨胀。搜索必须覆盖 Repository 名称、Wiki 标题、摘要、页面标题和 Approved Markdown。pending、仅 Generated、superseded、disabled、private 或 active pointer 不完整的 Wiki 不得进入列表、计数、搜索或详情；新分析在批准前继续显示旧 active Wiki。

统一知识列表必须显式区分资料派生 Knowledge Item 与 Repository Wiki。Candidate 可以继续编辑 Knowledge Item，但 Repository Wiki 在职业知识库中保持只读，任何编辑都只能从 Repository 审核页写 Approved Projection，且不能修改 Generated Version 或源码 Citation。现有 `type=repository` Knowledge Item 仍表示由文档资料整理出的仓库类职业知识，不得被误当作 Repository 聚合或覆盖；同一分类可以同时包含这类 Knowledge Item 和 active Repository Wiki，并由来源类型清楚区分。

Candidate 或授权 Public Visitor 点击可预览的 Repository Citation 时，当前页面必须打开来源阅读弹窗，以 Markdown 结构显示 Repository、固定完整 SHA、文件、行号和源码代码块；不得把 JSON API 地址作为新窗口导航目标。来源 API 仍返回结构化授权数据，UI 在每次打开时重新请求并接受即时权限复核；关闭弹窗后焦点返回原 Citation。

生成后的 Wiki 可以在 Candidate 中以导航树 + Markdown 阅读/编辑/预览方式显示 `pending review`；单页 Wiki 不显示多余层级，不再把每个 Claim 渲染成独立表单卡片。公共 Agent 只使用 Candidate 已批准的 Approved Projection。新 Revision 必须重新分析、重新审核；在新投影批准前，旧 active Revision 的 Approved Wiki 继续服务问答。

Wiki 必须记录 eligible file 总数、实际检查文件数与路径、已覆盖的主要区域、跳过原因，以及分析属于 targeted 或 broad。Candidate 可以查看 coverage，但 coverage 是诚实边界提示，不是主内容。任何输出不得声称完成全仓库逐文件阅读、全 API 枚举、编译测试或安全审计，除非存在对应运行 Evidence。

Repository Artifact、过滤规则或 Revision 变化必须生成新 Wiki。镜像、产品 Skill、system prompt 或 model profile 变化只将旧 Wiki 标记为 `analysis_outdated`，不使其自动失效，也不触发全量自动重跑；Candidate 或 Admin 可以对同一 Revision 发起重跑并重新审核。严重安全或正确性问题允许 Admin 通过确定性治理能力禁用相关 Wiki 或运行能力。

## 6. 文档检索与问答路由

Askme 的知识检索只保存和检索文档型资料、Knowledge Item 与 Approved Wiki，不保存或检索源码正文。V1 使用 PostgreSQL 结构化字段、全文搜索和必要的直接 Wiki section 加载，不引入向量数据库。

每次问题按以下顺序决策：

1. 确定性门禁检查身份、publication、owner、Repository visibility、公开深度分析开关、问题范围、短窗口滥用防护、并发和单次运行预算；任何 LLM 不能绕过这些门禁。问答 `conversation_analysis` 不按 Askme 内部日次数配额拒绝，未来是否可用只由独立 Token/积分余额合同决定；该合同未引入前不设置次数门禁。
2. 在允许的文档、Knowledge Item 和 Approved Wiki section 中进行初始检索。Repository 名称用于确定目标 Repository，不得同时作为 section 相关性的主要内容词；跨语言或词法证据无法回答时不能把“同仓库”当作“已找到答案”。
3. 轻量 Router 输出 `rag`、`deep` 或 `refuse`，并附稳定 reason code、confidence 和唯一 repository id。Host 必须持久化不含问题正文的 requested/effective route、reason code、confidence、repository id 与 evidence count，供当前运行验收和故障审计。低 confidence 先尝试普通回答；证据仍不足且门禁允许时才升级为 `deep`。
4. `rag` 使用检索到的文档或 Wiki section 回答；`deep` 创建异步 Deep Analysis Run 读取绑定 Revision 的原始 artifact；`refuse` 返回明确边界说明。RAG、Deep、证据不足与拒绝反馈都必须使用当前用户问题的主要语言；源码、标识符和既有专有名词可以保持原文，但不得把中文问答整体回答成英文或在没有语义需要时中英混写。

一个问题涉及多个 Repository 且无法唯一确定目标时，Askme 必须请用户明确选择，不猜测、不并行启动多个 sandbox。公共访客只可看到当前 publication 允许展示的项目名称。

普通回答与深度回答都必须区分 `answered`、`insufficient` 与 `refused`。深度分析启动后如果失败，不得伪装成成功的 RAG fallback；系统应保留失败状态和安全重试入口。

RAG Answer 选择 Repository Wiki Evidence 时，必须同时返回该 Evidence 中实际支撑最终回答的一个或多个 `[S*]` marker。Host 只验证并持久化这些 marker 对应的源码范围；同一 section 中未被回答选择的其他 marker 不得出现在“实际使用来源”。模型只选择 section、Host 自动展开 section 全部 Citation 的旧行为不再允许。回答无法把事实绑定到精确 marker 时必须返回证据不足或失败，不能用同仓库、同页面或内容 hash 有效代替事实关联。

### 6.1 会话推荐问题

推荐问题属于具体 Candidate Preview 或 Public Conversation，不属于全局 Agent Settings。空会话的推荐应根据当前可授权的 Repository 与职业知识生成引导性问题，优先帮助访问者了解项目、经历、技能和可验证成果；不能随机轮换一组与当前入口无关的问题。

每次回答进入终态后，系统必须使用该 conversation 当前全部已落库且仍可见的用户与 Assistant 消息，以及当前授权的知识主题，通过 LLM 重新生成与最后一条用户问题相同语言的后续问题。后续推荐应延续真实已讨论主题、避免重复已问问题、避免暗示证据中不存在的事实，并优先提出能够推进当前聊天进度、继续澄清或深入验证的问题；它们与产生它们的 conversation context version 一同保存。刷新只让 LLM 为同一上下文生成相关替代问题，不得切换到无关的预定义题库。RAG 与 Deep 回答均遵守同一更新语义；仅当 LLM 失败、超时或输出不合格时允许使用当前会话主题的确定性 fallback，且推荐失败不得使已完成回答失败。

## 7. 权限与 Citation 投影

Repository 的 visibility 在一个 Revision 内统一生效，沿用以下四级语义：

| Visibility | Repository Analysis / Wiki | Candidate Agent | 公共回答 | 公共 Citation |
| --- | --- | --- | --- | --- |
| `private` | 不启用 | 不可用 | 不可用 | 不可见 |
| `agent_only` | 可生成并审核 | 可使用 | 不可用 | 不可见 |
| `citation_allowed` | 可生成并审核 | 可使用 | 可使用 | 只显示允许的来源名称，不显示 commit、path、lines、snippet 或地址 |
| `public_preview` | 可生成并审核 | 可使用 | 可使用 | 可显示 commit、path、lines，并打开当前不可变源码视图 |

Pi 在 sandbox 内始终使用精确 repository、commit、path、lines 与 hash；最终 API 根据当前访问者权限重新投影。visibility 降低、publication 撤销或账号状态变化后，历史公共消息的 Citation 也必须按当前权限重新投影，不能依赖消息创建时的公开快照。

## 8. Deep Analysis Run 生命周期

每个 Deep Analysis Run 创建一个全新的临时 BoxLite microVM；生命周期按 run 而不是用户或会话划分，完成、失败或取消后必须清理，不跨 tenant 暖复用。基础镜像与只读缓存可以复用，但任何 guest 文件、凭证、上下文或进程不得跨 run 保留。

持久 run 状态至少包括 `pending`、`running`、`completed`、`failed`、`cancelled`，并与回答 outcome `answered`、`insufficient`、`refused` 分离。权限撤销、publication 失效或用户取消使仍未完成的 run 进入 `cancelled`；租约过期和 runner 中断由确定性 reconcile 恢复或终止。

最终用户问题、Assistant 最终消息、通过验证的 Citation 和最小 run metadata 可以持久化。模型中间 reasoning、工具逐步输出、临时文件和 guest 凭证不得持久化，也不得进入浏览器事件流、审计或日志。实时深度分析结论只属于当前会话，不写入 Wiki、Knowledge Item、RAG 或其他长期资料。

浏览器通过 SSE 观察 run。连接和重连先获得数据库当前快照，随后按单调 `analysis_runs.version` 接收状态事件；SSE 只推送 run id、version、状态和完成提示，客户端在完成后重新获取经过授权的最终资源。V1 不使用短轮询或 WebSocket，也不传输 reasoning、源码内容或 Secret。

## 9. AI Profile 与可配置性

V1 默认使用三个可独立配置的 Profile：

| Profile | 默认模型 | 默认模式 | 用途 |
| --- | --- | --- | --- |
| Router | `deepseek-v4-flash` | non-thinking | 问题复杂度与策略路由 |
| RAG Answer | `deepseek-v4-flash` | non-thinking | 文档与 Approved Wiki 回答 |
| Code Agent | `deepseek-v4-pro` | thinking/high | Repository Analysis 与 Deep Analysis |

模型名、base URL、timeout、retry、token、thinking/reasoning 和 provider compatibility 选项必须能由配置或环境变量覆盖。Askme 只依赖开发者提供的 OpenAI-compatible Chat Completions endpoint 与 API key，不判断 endpoint 是原生模型厂商还是外部 AI Gateway，也不负责上游 API key 的签发和管理。

## 10. 配额、预算与失败反馈

公共访问者只有在 Candidate 开启公开深度分析且 publication、visibility、短窗口滥用防护、并发与单次运行预算均允许时，才可自动触发 Deep Analysis Run，不需要逐问题 Human Gate。Askme 不以 Candidate、publication、visitor、Repository 或全局日运行次数限制 Agent 问答，也不以每个公开会话的每日问题数限制问答；未来 Token/积分余额与计费是独立业务合同，未引入前不能由次数配额替代。短窗口请求速率、运行并发、sandbox 资源和单次 timeout/round/tool/token 预算继续由 Host 强制。Repository Wiki 的离线生成仍可使用独立运维资源控制，但不得影响 Conversation Deep 准入。

Deep Analysis Run 默认预算：创建 microVM 30 秒、分析 120 秒、清理 30 秒；最多 50 个 LLM rounds、80 次工具调用、1 MiB 聚合工具输出、单次读取 64 KiB 或 500 lines、单次搜索 200 hits；Code Agent 默认模型最大输入上下文为 1,000,000 tokens、单次模型输出上限为 200,000 tokens；microVM 资源为 1 vCPU、1 GiB memory、2 GiB disk。Repository Analysis 的默认 80 次调用以前 48 次 `ls/find/grep/read` 为软边界：大型仓库达到至少 30 个真实 examined paths 后 guest 移除这些 source tools，只保留最多 32 次 `write_wiki`；不足 30 时拒绝过早写作并允许继续读取，但 source tools 最迟在 60 次时移除，硬保留至少 20 次写入与页面修正。修正 session 不重复 examined-path 门禁，Controller 合并首轮和修正轮真实 coverage。默认并发为 visitor 1、publication 2、runner global 2。

Repository Analysis Run 与 Deep Analysis Run 使用同一隔离运行时，但前者为支持大型仓库 Wiki 默认最长 20 分钟且为低优先级，后者仍为 120 秒并保持高优先级；全局并发 2 时至少为实时 Deep Analysis 保留一个 slot。所有默认值允许开发者配置。guest 非零退出且实际耗时到达 deadline 时，Host 必须返回稳定 `CODE_AGENT_ANALYSIS_TIMEOUT`，不得降级为不可诊断的通用 guest failure。

用户必须能区分等待、证据不足、拒绝、超时、上游 AI 失败、sandbox 失败、短窗口限流、取消和清理失败；服务端使用稳定错误码，不向 UI 暴露内部路径、Token、prompt、tool output 或 provider 原始敏感错误。

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

任一固定 SHA 无法获取时，验收必须失败，不能静默切换为最新 `main`。固定 public Revision 必须先生成一个可直接阅读的完整 Wiki bundle：Agent 根据仓库内容决定页面数量，覆盖主要模块与关键工作流、包含至少一张有效 Mermaid 图、合计不少于 8 个实质章节、检查不少于 30 个且跨主要子系统的代表性文件，并由 Host 从 sandbox `copyOut` 后验证全部文件和 `[S*]` Citation。随后整理约 10 个基准问题，覆盖 Wiki 普通检索、必须深度分析、Router 边界、证据不足和权限投影；每题记录期望 route、关键事实和最低 Citation 条件，不要求答案逐字匹配，也不要求用户预先编写或逐题审核标准答案。

## 13. 验收标准

- [x] `AC-REPO-001` GitHub.com 公开与私有 Repository 均能在显式同步时解析并固定完整 SHA，失败不会替换旧 active Revision。
- [x] `AC-REPO-002` 私有 Token 只存在于一次同步请求内；数据库、artifact、日志、错误、BoxLite 和持久凭证目录均无 Token。
- [x] `AC-REPO-003` archive 过滤、解压安全、路径与默认容量限制拒绝越界输入，artifact 保持只读且不包含被排除内容。
- [x] `AC-WIKI-001` 每个可分析新 Revision 在 sandbox 隔离输出目录生成 1–N 个结构化、可阅读和可导出的 Wiki Markdown；Host 在 cleanup 前安全 copy-out，并验证导航、架构/流程 Mermaid、模块与工作流说明、源码 Citation 和诚实 coverage，不创建源码 Chunk、embedding、AST 或向量索引。
- [x] `AC-WIKI-002` Generated Version 不可编辑；Candidate 以导航树和逐页 Markdown 阅读、编辑和预览 Approved Projection，危险内容、越界链接、无效 Citation 或新增无证据引用不可批准，UI 不再呈现 Claim 卡片编辑器。
- [x] `AC-WIKI-003` Approved Wiki 与已索引上传资料进入同一统一知识检索链路，供 Candidate Preview 和授权 Public Chat 使用；未审核 Wiki 不可检索，新 Revision 未批准时继续使用旧 active Revision，运行版本变化只标记 `analysis_outdated`。
- [x] `AC-KB-003` 职业知识库的列表、代码仓库分类、计数、搜索和详情统一投影当前 active Approved Repository Wiki；每个 Repository 只计一条、详情可读 1–N 个 Wiki 页面且保持只读，未审核或未授权 Wiki 不可见，同时 Candidate Preview 与授权 Public Chat 能在后续问题中使用同一 Wiki 与源码 Citation。
- [x] `AC-ROUTE-001` 确定性门禁先于 Router，Router 只能在 `rag`、`deep`、`refuse` 中选择且不能扩大 repository 或 visibility 权限。
- [x] `AC-ROUTE-002` 普通文档/Wiki 问题不启动 sandbox；需要原始代码的问题在证据不足时升级为一个 Revision 的 Deep Analysis Run。
- [x] `AC-ROUTE-003` 多 Repository 歧义要求用户选择，证据不足、拒绝和失败不伪装成成功回答或无提示 RAG fallback。
- [x] `AC-RUN-001` 每个深度 run 使用新的临时 BoxLite microVM，guest 状态、进程和凭证在结束后销毁且不跨 tenant 复用。
- [x] `AC-RUN-002` Pi 只加载 Askme 产品 Skill 和只读工具，Repository 中的指令文件无法改变运行时行为，代码仓库无法被写入。
- [x] `AC-RUN-003` Host 对最终结构、Citation、预算、权限和清理结果完成确定性校验；无效 Citation 修正一次后仍失败则不发布答案。
- [x] `AC-ASYNC-001` SSE 基于数据库 version 快照和事件恢复 pending/running/终态，不使用短轮询、WebSocket，也不泄露 reasoning、源码或 Secret。
- [x] `AC-PRIV-004` 四级 Repository visibility 同时约束 Wiki、Candidate/Public 回答和 Citation 投影；降权与撤销立即作用于历史公共消息。
- [x] `AC-AI-002` Router、RAG Answer 与 Code Agent Profile 可独立配置，默认模型符合合同，并可通过通用 OpenAI-compatible Chat Completions endpoint 工作。
- [x] `AC-COST-001` 超时、round、工具、输出、读取、搜索、token、microVM 资源、并发和 Repository Wiki 运维资源控制均由服务端强制，公共自动深度分析不能绕过；Agent 问答不设置日次数配额。
- [x] `AC-HISTORY-001` 最终会话消息、有效 Citation 和最小 run metadata 可恢复；中间 reasoning/tool output 不持久化，深度结论不进入 Wiki、RAG 或 Knowledge Item。
- [x] `AC-ACCEPT-001` 固定 `new-api` Revision 完成约 10 题路由、事实与 Citation 验收，固定 private Revision 完成一次性 Token、不可变 SHA、撤权和清理验收。
- [x] `AC-ANSWER-001` RAG 回答只持久化模型实际选择且能支撑最终陈述的 Repository `[S*]` 源码范围；Repository 名称与无关 section marker 不会膨胀来源，固定 copybook 项目概览问题不展示入口组件来源。
- [x] `AC-DEEP-001` Candidate 与 Public 的真实问题可以产生可审计 `deep` 有效路由和 `conversation_analysis`，由 worker 在新 microVM 读取固定 Revision 原始源码并提交有效 Citation；验收不能由 Router mock、Wiki `repository_analysis` 或 readiness 代替。
- [x] `AC-USAGE-001` Agent 问答和 Conversation Deep 不读取或消耗 Askme 日次数配额，Admin 不再配置公开会话每日问题数；短窗口滥用防护、并发和单次运行预算仍有效。
- [x] `AC-SUGGEST-001` 空会话展示基于当前授权知识的引导问题；每次 RAG/Deep 回答后，Candidate 与 Public 推荐均随同一 conversation 的完整可见上下文更新并保存 context version，刷新不退回无关预定义轮换。
- [x] `AC-LANGUAGE-001` 中文问题得到中文回答和中文推荐，英文问题得到英文回答和英文推荐；RAG、Deep、证据不足、拒绝与 refresh 均遵守，源码标识符与专有名词除外。

## 14. 已批准的后续延迟项

以下内容不阻塞 V1，只有出现真实需要时才重新决策：独立 AI processing consent 记录、对象存储、多 Web 实例事件分发、向量检索、跨仓库分析、按文件 visibility、其他 Git provider、计费、warm sandbox 和代码写入能力。
