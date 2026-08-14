# SPEC-002：职业知识与代码仓库 Agent V2 产品合同

Boundary ID：`askme-hybrid-agentic-rag-v2`

Owner boundary：Askme Candidate 职业知识检索、Repository 文档知识、Agent 问答、Citation、源码 Deep Analysis、权限投影与评估门禁。

Status：`approved`

当前交付 Plan：[PLAN-020](../plans/PLAN-020.md)

## 1. 目标与替代边界

Askme 必须把 Candidate 已授权的职业资料与 Repository 文档转化为可检索、可排序、可验证、可撤销的证据。Candidate Preview 与 Public Chat 使用同一权限优先的 Hybrid Agentic RAG V2：先理解问题，再并行召回精确词、全文、向量和结构化证据，经过融合、独立重排、覆盖判断和 Claim 验证后生成带 Citation 的回答。

“没有更多证据”只允许表示核心问题在当前授权 Evidence 中确实没有支持，不能被中文分词失败、索引未就绪、Provider 故障、回答模型失败或 Citation 校验失败冒充。

本合同直接替代此前 `SPEC-002` 的 V1 文档检索边界：

- V2 使用 PostgreSQL 18 + pgvector，不保留 V1 全文检索回答链路、双写、功能开关或兼容回退；
- 安全白名单内的 Repository Markdown 与可直接提取文本的 PDF 可以进入长期索引；原始源码仍不得进入持久 Embedding；
- Approved Wiki、Knowledge Item 和原始证据建立血缘，不得把同一事实的派生副本当成多份独立 Evidence；
- 账号、原始材料、Knowledge Item、Repository、权限与会话等业务数据必须保留，V1 chunk、FTS 和其他派生检索数据允许清空重建；
- Repository Wiki 与隔离 Deep Analysis 的现有只读源码边界继续有效，除非本合同明确替代。

文件、Website、Notion、Knowledge Item、四级可见性、Candidate 发布和 Admin 治理的通用行为继续由 [SPEC-001](SPEC-001.md) 拥有。

## 2. 角色与术语

- **Candidate**：Source、Repository、visibility、publication、索引状态、Retrieval Trace 和反馈的 owner。
- **Interviewer / Visitor**：只能在当前 Candidate publication 和 Evidence visibility 允许的范围内问答和读取 Citation。
- **Platform Admin**：查看全局索引与 Provider 健康、失败和安全审计，不通过管理能力绕过 tenant 权限读取正文。
- **Parent Chunk**：保留完整语义结构的证据上下文，例如一段完整任职经历、一个文档章节或一个 PDF 小节。
- **Child Chunk**：用于关键词和向量召回的较小片段，Citation 绑定其原始来源范围。
- **Index Version**：固定 chunking、Embedding model/dimension、contextual prefix 和 distance metric 的派生索引版本。
- **Evidence**：Host 能定位、实时授权并校验 checksum 的 Material Child、Repository Document Child 或 Approved Wiki section。
- **Evidence Family**：原始 Evidence 与其 Knowledge Item、Wiki 等派生投影的血缘集合。
- **Retrieval Policy Version**：Query Planning、TopK、RRF、Rerank、Evidence budget 和阈值的版本；改变该版本不要求重新 Embedding。
- **Coverage**：`full | partial | none | conflicted`；权限/安全拒绝使用独立 `refused`，系统故障使用 `failed`。
- **Retrieval Trace**：仅 Candidate/Admin 可见的查询规划、各路召回、排序、覆盖、降级和过滤诊断。

## 3. V2 范围与非目标

V2 索引以下来源：

1. 状态为 `indexed` 的上传文件、Website 和 Notion 等文档材料；
2. Candidate-edited Knowledge Item 及其链接的 `knowledge_evidence`；
3. Candidate 已批准的 Repository Wiki section；
4. 成功同步的不可变 Repository active commit 中，安全白名单允许且 Repository 已批准用于 Agent 的 Markdown/PDF。

V2 不提供扫描 PDF OCR、原始源码 Embedding、AST/call graph 向量化、跨 Candidate 检索、自动修改上游 Repository、在线训练、反馈驱动的实时权重修改、GitHub webhook 自动同步或新的生产计费能力。

Repository 原始源码只允许由既有隔离 Deep Analysis 在一个成功同步的不可变 Revision 内只读分析；分析中间结论、reasoning、工具输出和临时文件不得进入长期 RAG。

## 4. 结构优先的 Parent–Child 索引

### 4.1 切分行为

系统必须先识别文档结构，再按 token 上限切分：

- Child 目标范围为 `350–500 tokens`，默认目标约 `420`，hard max `650`；低于 `80` 的片段与相邻语义段合并；
- Parent 目标范围为 `900–1,500 tokens`；
- 标题、段落、列表、表格、Markdown section、HTML section、DOCX heading、PDF 页与段、PPTX slide、XLSX sheet/table、Knowledge Item 和 Approved Wiki section 是优先边界；
- 正常语义边界不重叠；只有单个结构单元超过 hard max 时才允许 `40–64 tokens` overlap；
- 简历中同一公司/岗位的名称、任职时间、职责和成果必须保留在同一 Parent，不得把“富途控股/岗位”与其职责拆成失去上下文的 Child；
- contextual prefix 只进入 Embedding 输入，必须版本化；Citation 始终绑定未经 prefix 改写的原始文本。

所有 token 计数使用同一确定性 tokenizer/计数边界。索引记录必须保存 source、owner、visibility、Parent/Child、原始范围、checksum、evidence family 和 index version。

### 4.2 Embedding 与版本

Embedding 使用独立 Provider，默认模型为 `qwen3.7-text-embedding`、`1024` dimensions、cosine distance。`embedding_version` 至少包含 provider、model、dimension 和 contextual-prefix version；`index_version` 另含 chunking version、metric 和创建时间。

新 index 经过 `building → ready → active`，失败为 `failed`，被替代版本为 `superseded`。一次检索只能使用一个 active index version，禁止混合不同 Embedding 版本。来源 revision 的新索引只有全部必要派生数据成功后才能原子激活；失败时旧 active 可继续服务。来源删除、权限降低或发布撤销不等待 GC，必须立即让所有版本不可检索。

V2 默认在经过 owner、visibility、source state 和 version 过滤后的候选集执行 pgvector exact cosine search。只有 active vector 达到 `100,000` 或 exact search P95 超过 `100 ms`，并通过 exact/HNSW recall 对照后，才允许启用 HNSW。

## 5. Repository Markdown/PDF

### 5.1 发现与容量

Repository 只读取 Candidate 显式同步成功的不可变 commit。默认自动发现：

- `README*.md`；
- Repository 根目录 Markdown；
- `docs/**/*.md`；
- `docs/**/*.pdf`。

include/exclude glob 可配置。默认排除 `.git`、dependency、cache、build、coverage、generated output、secret/credential、symlink、特殊文件和现有 Repository archive 安全过滤规则拒绝的路径。

默认容量值均可配置：

| 对象 | 默认上限 |
| --- | --- |
| 单个 Markdown | `2 MiB` |
| 单个 PDF | `50 MiB / 500 页` |
| 单个 Repository revision 提取文本 | `5,000,000 tokens` |

超限、不支持或无法直接提取文本的文件不得截断或静默忽略；系统记录稳定原因，并使 revision 成为 `ready_with_warnings`。无法提取文本的 PDF 使用 `unsupported_no_extractable_text`，V2 不启动 OCR。

### 5.2 Repository 级批准与版本

Repository 首次同步默认 private。Candidate 按整个 Repository 批准，不按文件批准；批准后，安全白名单内现有及未来新增、修改的 Markdown/PDF 自动继承 Repository visibility。删除文件必须立即使对应 Evidence 失效。

普通问答只使用最新成功同步且完成索引的 active commit。旧 commit 索引可以暂留用于原子回滚，但不参与普通检索；只有用户明确询问历史版本时，才允许按完整 commit 限定检索。

“Repository 同步成功”和“RAG 索引可用”是独立状态。Candidate 至少能看到：

`syncing → synced/indexing → ready | ready_with_warnings | failed`

反馈同时展示 active commit、已索引/跳过文件数和稳定失败原因。新 revision 索引失败时旧 active commit 可以继续服务，但必须明确标记资料可能滞后。

## 6. Query Planning 与混合召回

### 6.1 Query Planning

每次问题先经过确定性处理：Unicode 规范化、中文词边界、实体/精确短语、CJK n-gram、中英混合和会话指代补全。不得把连续中文整句当作单个 PostgreSQL lexeme。

结构化 Query Planner 最多输出：standalone query、entities、must terms、should terms、两个 semantic queries 和 desired evidence type。Planner 不能选择 tenant、提升 visibility、扩大来源或改变工具能力。Planner 失败时使用确定性查询继续。

### 6.2 多路召回与融合

权限过滤后默认并行执行：

| Route | 默认 TopK | RRF weight |
| --- | ---: | ---: |
| exact phrase/entity | 20 | 1.5 |
| PostgreSQL FTS + `pg_trgm` lexical | 30 | 1.0 |
| pgvector exact cosine | 30 | 1.0 |
| Knowledge Item / structured fields | 20 | 1.2 |

系统使用 weighted RRF，默认 `k=60`。所有 TopK、weight、RRF k、阈值和每 Parent Child 数都必须配置化。候选按 stable ID/checksum 去重，默认同一 Parent 最多保留三个 Child。

Knowledge Item 只作为检索锚点；命中后必须展开到 `knowledge_evidence` 对应的 Material Child。未经来源支撑的 Candidate 编辑不能独立成为最终 Claim Evidence。Approved Wiki 可以作为最终 Evidence，但必须保留 Host 验证的 `[S*]` 原始来源血缘。

## 7. Rerank、Evidence Pack 与有界补检

RRF 候选交给独立 Rerank Provider，默认模型为 `qwen3-rerank`。Rerank 与 Chat LLM 必须使用独立 Profile、配置、超时、重试和 usage 记录；允许部署者显式复用同一上游 API key，但不能共享行为状态。

Evidence fusion 必须遵守：

- 同一 `evidence_family` 只计一份独立证据，不能因原始材料、Knowledge Item 和 Wiki 重复出现而提高置信度；
- 来源互相矛盾时输出 `conflicted`，同时保留冲突双方 Citation，不按来源类型或时间静默覆盖；
- Evidence Pack 的默认 hard ceiling 为 `200,000 tokens`，不是填充目标；覆盖充分时提前停止；
- effective budget 是配置上限与 `model context - system - conversation - output reserve - safety margin` 的较小值；
- 每次记录 configured/effective/actual evidence tokens。

Evidence Judge 输出 `full | partial | none | conflicted`：

- `full`：核心方面均有充分 Evidence；
- `partial`：只回答被支持方面，并明确列出不支持方面；
- `none`：核心方面均无支持；
- `conflicted`：一个或多个核心事实存在不可消解冲突；
- `refused`：权限、publication、滥用或安全门禁拒绝；
- `failed`：Provider、Answer、Citation 等系统失败。

初检不完整时，Judge 可以基于 unsupported aspects 产生一次定向补检。一个问题最多两轮检索；补检不得扩大授权来源，结果必须与第一轮去重。第二轮失败后只能基于第一轮输出 partial/none，不能无界重试。

## 8. Claim 验证与 Citation

Answer Generator 必须先生成结构化 coverage、claims、aspectId、evidenceIds 和 unsupported aspects。Host 先校验每个 evidence ID 的 owner、visibility、active version、checksum 和来源状态，再交给独立 Claim Verifier。

Claim Verifier 只读取该 Claim 引用的 Evidence subset，输出 `entailed | partially_entailed | unsupported | contradicted`。Host 删除 unsupported/contradicted Claim，收窄 partially_entailed Claim，最多允许一次受控修复。最终 Markdown 由 Host 渲染；Citation Validator 失败时不得持久化或输出无 Citation 替代答案。

Citation 形态：

- Material：Material/Child ID 与稳定 checksum；
- Repository Markdown：`repository/path@full_commit_sha#Lx-Ly`；
- Repository PDF：`repository/path@full_commit_sha#page=N`；
- Approved Wiki：section 与 Host 验证的 `[S*]` Repository source range。

Candidate/Public Citation 统一打开 Askme 内部稳定阅读页，并在每次读取时重新授权。Public GitHub Repository 可以附加外部源链接；private Repository 不得暴露 GitHub Token、临时 clone URL 或未批准内容。

## 9. 权限、Prompt Injection 与强撤销

owner、account status、publication、visibility、source state、active revision 和 index version 过滤必须发生在 exact、FTS、trigram 和 vector 检索之前。任何 LLM、Embedding、Rerank 或 Repository 内容不能扩大该集合。

Repository visibility 继续使用 `private | agent_only | citation_allowed | public_preview`：

| Visibility | Candidate Agent | Public answer | Public Citation |
| --- | --- | --- | --- |
| `private` | 不可用 | 不可用 | 不可见 |
| `agent_only` | 可用 | 不可用 | 不可见 |
| `citation_allowed` | 可用 | 可用 | 只显示允许的来源名称 |
| `public_preview` | 可用 | 可用 | 可显示授权片段、commit、path 和范围 |

GitHub public 不等于 Askme public；Repository 在 Askme 中默认 private，必须由 Candidate 显式设置整个 Repository visibility。

所有材料、Markdown、PDF、Wiki 与 Repository 指令文件均是不可信数据。即使内容要求忽略规则、调用工具、读取其他 tenant 或泄露 Secret，系统也只能把它当作证据正文，不得改变 system prompt、检索范围、权限、模型配置或工具能力。

权限撤销使用强撤销：

- 后续问答立即停止使用失效 Repository/Source；
- 历史 Citation 重新按当前权限投影，撤销后不再展示片段；
- 依赖失效 Evidence 的历史回答持久标记 `evidence_revoked`，不再作为可验证答案传播；后续恢复 visibility 或重建 source 不得让旧回答和 Citation 自动复活；
- 审计只保留必要 evidence ID、commit、checksum 和事件，不建立可绕过权限的正文副本。

## 10. 源码 Deep Analysis

实现级源码问题在文档 RAG 无法回答且 Host 唯一确定一个授权 Repository 时，可以进入现有 `deep` 路由。每个 Deep Analysis Run 只读取一个成功同步的不可变 Revision，在新的临时 BoxLite microVM 内运行只读工具；不得写 Repository、执行项目代码、安装依赖、访问网络或加载 Repository 自带指令。

Deep run 的 `pending | running | completed | failed | cancelled` 与回答 outcome 分离。最终回答和 Host 验证 Citation 可以进入会话；reasoning、工具逐步输出、临时分析文件和中间结论不得持久化或进入 RAG。Deep 失败必须显示真实失败，不得伪装成 RAG none。

多 Repository 无法唯一确定时必须要求用户选择，不猜测、不并行启动多个 sandbox。SSE 只发送 run id、version、状态和完成提示，不泄露源码、reasoning 或 Secret。

## 11. Provider、配置与降级

V2 使用可独立配置的 Query Planner Chat、Embedding、Rerank、RAG Answer、Claim Verifier 与 Code Agent Profile。模型名、base URL、API key、timeout、retry、token/context budget 和 provider compatibility 均由受控配置读取，Secret 不进入日志、Trace、数据库、文档或 Commit。

默认降级：

- Planner 失败：确定性查询；
- Embedding 失败：exact + lexical + structured；
- Rerank 失败：使用 RRF，Evidence Judge 提高充分性要求；
- 第二轮失败：第一轮 partial/none；
- Answer 或 Claim Verifier 失败：显式 failed；
- Citation Validator 失败：拒绝输出。

模型能力可以降级，Evidence 与权限边界不能降级。Candidate 能看到 `basic retrieval mode` 等安全状态提示。

## 12. Retrieval Trace 与反馈

Candidate/Admin 可以查看一次问答的 Retrieval Trace：

- retrieval policy、active index、source revision/commit；
- Planner 的实体、关键词和 semantic queries；
- exact/lexical/vector/structured 各路命中数；
- RRF/Rerank 后的 evidence ID、分数和筛选原因；
- Coverage、补检、降级、跳过、权限过滤与索引告警。

Trace 不向 Interviewer 展示，不包含 system prompt、Embedding vector、未授权正文或 Provider 敏感原始错误。

点赞、点踩和 Candidate 纠正只作为离线评估标签。它们不能在线修改 RRF 权重、Knowledge Item、Evidence、Embedding 或模型。任何检索策略变化必须产生新的 `retrieval_policy_version` 并重新通过发布门禁。

## 13. Golden Dataset 与发布门禁

仓库内维护完全合成、无真实个人信息的三名虚构 Candidate 材料和 120 个问题：

| 类型 | 数量 |
| --- | ---: |
| 精确事实 | 30 |
| 中文改写 | 25 |
| 中英混合/缩写 | 15 |
| 多轮指代 | 15 |
| partial | 15 |
| none | 10 |
| 权限/越界 | 10 |

材料覆盖全部 visibility、Material/Knowledge Item/Approved Wiki/Repository Markdown/PDF、重复血缘、冲突、长文档、Prompt Injection 和 Provider 降级。每个 case 标注 expected outcome、coverage、required/forbidden evidence IDs、可选 acceptable Citation IDs 和 tags；required ID 用于 Recall，Citation precision 接受所有能直接支持目标 Claim 且未被禁止的标注证据。

V2 发布必须满足：

- initial Recall@30 `>=95%`；
- rerank evidence Recall@8 `>=90%`；
- Citation precision `=100%`；
- answerable 被误判 none `<=5%`；
- unanswerable 虚构回答 `=0`；
- 未授权泄露 `=0`；
- outcome classification `>=95%`。

指标必须按语言、来源、问题类型和降级模式分段。真实账号和个人材料只用于非持久最终验收，不进入仓库 Golden Dataset。

## 14. 验收标准

- [x] `AC-RAG2-001` 中文精确问题、改写和中英混合问题均能召回富途等完整任职 Parent/Child，不再因连续中文 lexeme 导致零召回。
- [x] `AC-RAG2-002` Material、Knowledge anchor、Approved Wiki 和 Repository 文档经过 exact/lexical/vector/structured、RRF 与独立 Rerank，且所有 TopK、权重、阈值和 evidence budget 可配置。
- [x] `AC-RAG2-003` pgvector 使用固定 1024 维 Embedding version、过滤后 exact cosine 和原子 active index；重建派生索引不删除业务数据，也不混合不同版本。
- [x] `AC-RAG2-004` Parent–Child 切分遵守结构、token、上下文和范围约束，简历公司/岗位/职责不会失去关联。
- [x] `AC-RAG2-005` Evidence Judge 正确区分 full、partial、none、conflicted、refused 和 failed，最多进行一次不扩大权限的定向补检。
- [x] `AC-RAG2-006` Claim Verifier 删除或收窄无支持/矛盾 Claim，Citation Validator 只允许当前授权、active、checksum 有效的 Evidence。
- [x] `AC-RAG2-007` Embedding、Rerank、Planner 和第二轮失败按合同安全降级；Answer/Verifier/Citation 失败不伪装成“证据不足”。
- [x] `AC-REPO-DOC-001` Repository 级批准后，白名单内当前和未来 Markdown/PDF 自动索引并继承 visibility；源码与扫描 PDF 不进入 Embedding。
- [x] `AC-REPO-DOC-002` Repository sync 与 index readiness 独立可见，超限/不支持文件产生 ready_with_warnings 和稳定原因，新索引失败不混用 commit。
- [x] `AC-REPO-DOC-003` Repository Citation 固定完整 commit、path、line/page 和 checksum；Askme 阅读页实时授权，权限降低执行强撤销。
- [x] `AC-EVIDENCE-001` Evidence family 防止派生副本重复增信；冲突来源不静默覆盖并同时显示双方 Citation。
- [x] `AC-SEC-RAG-001` Prompt Injection、Repository 指令和恶意材料不能改变权限、Prompt、Provider、工具或检索范围，未授权泄露为零。
- [x] `AC-TRACE-001` Candidate/Admin 能查看不含敏感正文和向量的 Retrieval Trace，Interviewer 不可访问。
- [x] `AC-FEEDBACK-001` 用户反馈只进入离线标签，策略改变以新 retrieval policy version 通过门禁后发布。
- [x] `AC-EVAL-001` 120 题合成 Golden Dataset 达到全部召回、排序、Citation、拒答、权限和 outcome 阈值。
- [x] `AC-ACCEPT-002` 保留业务数据部署后，目标账号的富途经历和已批准 Repository 文档问题在真实浏览器返回正确回答、有效 Citation 和可解释 Trace。

## 15. 已批准的延迟项

OCR、HNSW 默认启用、其他 Git provider、跨 Repository Deep Analysis、原始源码 Embedding、在线训练、自动反馈调权、计费和生产多 Region 不阻塞 V2。HNSW 只有达到本合同容量/延迟阈值并通过 recall 对照时才可提前启用。
