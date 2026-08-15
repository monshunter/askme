# SPEC-002：成熟 Query-understood Entity-grounded RAG 与代码仓库 Agent 产品合同

Boundary ID：`askme-query-understood-rag-v4`

Owner boundary：Askme Candidate 职业知识检索、Repository 文档知识、Agent 问答、Citation、源码 Deep Analysis、权限投影与评估门禁。

Status：`approved`

当前交付 Plan：[PLAN-026](../plans/PLAN-026.md)

## 1. 目标与替代边界

Askme 必须把 Candidate 已授权的职业资料与 Repository 文档转化为身份明确、可检索、可排序、可验证、可撤销的证据。Candidate Preview 与 Public Chat 使用同一权限优先的 Query-understood Entity-grounded Hybrid RAG：LLM Query Understanding Agent 结合当前问题、受控会话上下文、Host 确定性 seed 和上一轮可信 Retrieval Trace，解析真实意图、主体、知识范围、命名实体在问题中的角色、约束和待求字段；只有答案必须归属于它或受它约束的 Required Entity 才进入严格 Entity Grounding，Discovery 问题则在全部授权知识中检索待求字段。随后系统进行精确词、全文、向量和结构化召回，经过融合、独立重排、Answerability 判断和 Claim 验证后生成带 Citation 的回答。语义相似只能发现相关内容，不能把不同名称的项目、人、公司、产品或 Repository 当作同一实体，也不能凭空制造用户没有指定的实体约束。

“没有更多证据”只允许表示核心问题或用户明确指定的实体在当前授权 Evidence 中确实没有支持，不能被中文分词失败、索引未就绪、Provider 故障、回答模型失败或 Citation 校验失败冒充。若用户明确询问 `askme` 而当前授权知识只包含 `onecat`，系统必须在检索前或 Answerability Gate 拒绝把 OneCat 事实改名为 Askme；不得用“语义相似”替代身份一致。

同一原则的对偶必须同时成立：用户询问“2022 到 2024 年在哪家公司任职、担任什么职务、负责什么”时，公司、职务和职责是待求字段，不是预先给出的实体；`你` 指向当前 `profile_owner`，也不是普通 person entity。系统不得把“你在哪家”“哪家公司”“什么项目”等问句片段送入 Entity Catalog 并因此提前拒答。时间范围属于检索和 Answerability 约束，任职区间以 overlap 判断，不做字符串或起止年份 exact match。

本合同直接替代此前 `SPEC-002` 的 V1 文档检索边界：

- 当前 RAG 使用 PostgreSQL 18 + pgvector，不保留 V1 全文检索回答链路、双写、功能开关或兼容回退；
- 安全白名单内的 Repository Markdown 与可直接提取文本的 PDF 可以进入长期索引；原始源码仍不得进入持久 Embedding；
- Approved Wiki、Knowledge Item 和原始证据建立血缘，不得把同一事实的派生副本当成多份独立 Evidence；
- 项目尚未上线，不保留旧 Query/Entity Policy 或旧派生索引兼容路径；账号、原始材料、Repository、权限、Publication 与会话等业务事实必须保留，Knowledge Item、chunk、FTS、Embedding 和其他可重建派生知识允许按明确维护入口清空重建；
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
- **Entity Catalog**：从当前授权的 Repository 身份和有 Evidence 绑定的 Knowledge Item 实时投影出的 Candidate 级实体目录；它不是独立人工维护的第二份知识真相。
- **Query Semantics**：一次问题的受控语义合同，由 `intent`、`subject`、`queryMode`、`knowledgeScope`、带角色的 `entityMentions`、`constraints`、`requestedFields`、`confidence` 和 `ambiguities` 组成；它描述已知条件、上下文与待求变量，不授予数据访问权限。
- **Query Understanding Agent**：使用独立 LLM Profile 的有界语义 Agent。它读取当前问题、最近受控会话、Host seed、当前问题内的 Catalog alias 候选和上一轮可信实体焦点，最多进行一次初始解析与一次条件触发的语义裁决；不能读取未授权 Evidence 正文或选择权限范围。
- **Subject**：问题围绕的主体。Candidate Preview 与 Candidate 的 Public Agent 中，`我/你/本人/候选人/这个人` 默认解析为 `profile_owner`，不进入 Entity Catalog。
- **Query Mode**：`focused | discovery | clarify`。`focused` 有 Required Entity，`discovery` 从授权知识寻找未知对象/字段，`clarify` 只用于多个真实合理解释会改变答案且无法由上下文消解的情况。
- **Knowledge Scope**：问题所属的职业知识域，例如 `employment`、`project`、`skill`、`education`、`repository` 或 `general`；它用于检索规划和排序，不替代 visibility 或 Entity Scope。
- **Named Entity Mention**：当前问题明确写出或由可信上一轮焦点恢复的具体对象名称及类型提示。当前问题出现一个名称不等于答案必须归属它；Agent 必须为 mention 标记 `required | context` 角色。
- **Required Entity**：Named Entity Mention 中被 Query Understanding Agent 与 Host 共同确认是答案主体、比较对象或硬约束的子集；只有该子集进入 Entity Resolution 与 Entity Scope。Context mention 只参与语义理解和软检索，不触发硬门禁。
- **Constraint**：已知筛选条件；V4 首先支持 inclusive time range。只给年份时，开始边界规范化为该年 1 月，结束边界规范化为该年 12 月。
- **Requested Field**：用户要求从 Evidence 求出的字段，例如 company、job title、responsibilities、achievements、project name、positioning、functions 或 technologies；不得拿它做 Entity lookup。
- **Entity Mention**：Query Understanding Agent 从当前问题或受控会话实体指代形成的实体原文、类型提示、`explicit | contextual` 来源和 `required | context` 角色；只有 `required` mention 允许进入 Entity Resolution。
- **Entity Resolution**：将 Entity Mention 通过规范化 canonical name/alias 精确映射到 Entity Catalog；不得使用向量 nearest neighbor 把未知实体映射为“最像”的已知实体。
- **Entity Scope**：Entity Resolution 后允许参与当前问题的 Material/Repository source 集合；该范围只能缩小已授权集合，不能扩大 visibility。
- **Retrieval Policy Version**：Query Planning、TopK、RRF、Rerank、Evidence budget 和阈值的版本；改变该版本不要求重新 Embedding。
- **Coverage**：`full | partial | none | conflicted`；权限/安全拒绝使用独立 `refused`，系统故障使用 `failed`。
- **Retrieval Trace**：仅 Candidate/Admin 可见的查询规划、各路召回、排序、覆盖、降级和过滤诊断。

## 3. 范围与非目标

成熟 RAG 索引以下来源：

1. 状态为 `indexed` 的上传文件、Website 和 Notion 等文档材料；
2. Candidate-edited Knowledge Item 及其链接的 `knowledge_evidence`；
3. Candidate 已批准的 Repository Wiki section；
4. 成功同步的不可变 Repository active commit 中，安全白名单允许且 Repository 已批准用于 Agent 的 Markdown/PDF。

Material ingestion 的知识组织结果必须为每个 Knowledge Item 输出有类型的 canonical entity 与有限 aliases，并把它们绑定到该 Item 的实际 `knowledge_evidence`；Repository entity 则以 Askme 已同步的 Repository record 为身份 owner。通用章节名、问句模板和无证据的模型推断不得进入 Catalog。Candidate 修改 Knowledge Item 展示标题或摘要不会自动创建新的实体身份；实体变化必须重新组织来源，或经受控且可验证的实体编辑能力写入。

本合同不提供扫描 PDF OCR、原始源码 Embedding、AST/call graph 向量化、跨 Candidate 检索、自动修改上游 Repository、在线训练、反馈驱动的实时权重修改、GitHub webhook 自动同步、新的生产计费能力或通用 Knowledge Graph。Entity Catalog 只解决当前授权职业知识中的稳定身份与别名，不推断未被 Evidence 支持的实体关系。

Repository 原始源码只允许由既有隔离 Deep Analysis 在一个成功同步的不可变 Revision 内只读分析；分析中间结论、reasoning、工具输出和临时文件不得进入长期 RAG。

## 4. 结构优先的 Parent–Child 索引

### 4.1 切分行为

系统必须先识别文档结构，再按 token 上限切分：

- Child 目标范围为 `350–500 tokens`，默认目标约 `420`，hard max `650`；低于 `80` 的片段与相邻语义段合并；
- Parent 目标范围为 `900–1,500 tokens`；
- 标题、段落、列表、表格、Markdown section、HTML section、DOCX heading、PDF 页与段、PPTX slide、XLSX sheet/table、Knowledge Item 和 Approved Wiki section 是优先边界；
- 正常语义边界不重叠；只有单个结构单元超过 hard max 时才允许 `40–64 tokens` overlap；
- 简历中同一公司/岗位的名称、任职时间、职责和成果必须保留在同一 Parent，不得把“富途控股/岗位”与其职责拆成失去上下文的 Child；
- contextual prefix 至少包含 source title、structure path 和该来源由授权 Entity Catalog 投影出的 canonical entity/alias；它只进入检索表示与 Embedding 输入，必须版本化，Citation 始终绑定未经 prefix 改写的原始文本。

所有 token 计数使用同一确定性 tokenizer/计数边界。索引记录必须保存 source、owner、visibility、Parent/Child、原始范围、checksum、evidence family 和 index version。

### 4.2 Embedding 与版本

Embedding 使用独立 Provider，默认模型为 `qwen3.7-text-embedding`、`1024` dimensions、cosine distance。`embedding_version` 至少包含 provider、model、dimension 和 contextual-prefix version；`index_version` 另含 chunking version、metric 和创建时间。

新 index 经过 `building → ready → active`，失败为 `failed`，被替代版本为 `superseded`。一次检索只能使用一个 active index version，禁止混合不同 Embedding 版本。来源 revision 的新索引只有全部必要派生数据成功后才能原子激活；失败时旧 active 可继续服务。来源删除、权限降低或发布撤销不等待 GC，必须立即让所有版本不可检索。

当前实现默认在经过 owner、visibility、source state 和 version 过滤后的候选集执行 pgvector exact cosine search。只有 active vector 达到 `100,000` 或 exact search P95 超过 `100 ms`，并通过 exact/HNSW recall 对照后，才允许启用 HNSW。

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

超限、不支持或无法直接提取文本的文件不得截断或静默忽略；系统记录稳定原因，并使 revision 成为 `ready_with_warnings`。无法提取文本的 PDF 使用 `unsupported_no_extractable_text`，当前合同不启动 OCR。

### 5.2 Repository 级批准与版本

Repository 首次同步默认 private。Candidate 按整个 Repository 批准，不按文件批准；批准后，安全白名单内现有及未来新增、修改的 Markdown/PDF 自动继承 Repository visibility。删除文件必须立即使对应 Evidence 失效。

普通问答只使用最新成功同步且完成索引的 active commit。旧 commit 索引可以暂留用于原子回滚，但不参与普通检索；只有用户明确询问历史版本时，才允许按完整 commit 限定检索。

“Repository 同步成功”和“RAG 索引可用”是独立状态。Candidate 至少能看到：

`syncing → synced/indexing → ready | ready_with_warnings | failed`

反馈同时展示 active commit、已索引/跳过文件数和稳定失败原因。新 revision 索引失败时旧 active commit 可以继续服务，但必须明确标记资料可能滞后。

## 6. Query Understanding、条件 Entity Gate 与混合召回

### 6.1 Query Semantics

每次问题先经过确定性处理：Unicode 规范化、中文词边界、精确短语、CJK n-gram、中英混合、职业域/待求字段、时间范围、显式命名实体和会话指代。不得把连续中文整句当作单个 PostgreSQL lexeme，也不得用一次宽泛 NER 同时承担意图、主体、约束和待求字段判断。

Host 与 Query Understanding Agent 必须共同产出并校验以下最小 Query Semantics：

```json
{
  "intent": "employment_history",
  "subject": "profile_owner",
  "queryMode": "discovery",
  "knowledgeScope": "employment",
  "entityMentions": [],
  "constraints": {
    "timeRange": { "start": "2022-01", "end": "2024-12" }
  },
  "requestedFields": ["company", "job_title", "responsibilities"],
  "confidence": 0.98,
  "ambiguities": []
}
```

`entityMentions` 只允许包含当前问题中明确写出的具体名称，或由同一 Conversation 上一轮可信 Trace 恢复的实体焦点。Host 必须拒绝把疑问短语、请求属性、代词、动词、通用知识域或不完整名词短语接受为 Named Entity Mention，包括但不限于“哪家公司”“你在哪家”“什么项目”“什么职位”“哪些经历”“负责什么”以及对应英文问句。`我/你/本人/候选人/这个人` 解析为 `profile_owner`；只有“它/该项目/that project”等确实指向上一轮实体的表达进入受控 contextual resolution。

Host 必须独立用当前 Authorized Entity Catalog 对原始 Query 执行最长 Alias 扫描，把命中作为 Query Understanding Agent 的可信 identity 候选；即使用户只写“Askme 怎么样”而没有“项目/产品”等类型后缀，也必须保留 Askme candidate。该扫描只接受 Catalog 中已有 canonical/alias 的确定性命中，不用向量或模型推断新 Alias；较短 Alias 完全落在同一位置的较长 Alias 内时只保留较长者，避免 `new-api` 同时误命中无关 `api` 实体。Catalog 命中本身不决定 `required`：例如“看过 Askme 后，我还做过哪些项目”中的 Askme 是 context，不能把项目发现问题硬缩到 Askme source。

Query Understanding Agent 的初始 LLM 调用输出 Query Semantics、standalone query、带原文/类型/来源/角色的 entity mentions、must terms、should terms、两个 semantic queries 和 desired evidence type。输入包含最近受控会话、Catalog alias candidates 与上一轮 Trace focus，但不包含 Catalog 全量或未检索 Evidence。Host 保留所有有效 named candidates；Provider 提出的 unknown mention 只有在其原文位于当前问题、通过 Host 命名候选校验且不属于问词/代词/待求字段时才可接受。Agent 的 rewrite 不得删除/改名 required mention，也不得把 constraint 与 requested field 互换。

以下情况必须触发一次独立的语义裁决调用：初始 Agent 准备以 missing/ambiguous Required Entity 在检索前停止；LLM 与确定性/Catalog seed 对实体角色或主体存在冲突；`queryMode`、intent 或 requested fields 低置信；同一名称既可能是上下文又可能是答案主体。裁决读取两套候选和受控会话，输出最终语义选择与简短结构化理由；最多一次，不形成无界 Agent 循环。Host 再做 span、枚举、权限和不变量校验。两次 LLM 均失败时使用保守确定性 fallback：明确 target 语法和可信唯一上下文可以 focused，其余为 discovery；只有真实多义且不同解释会改变答案时进入 clarify。

Query Understanding Agent 不能选择 tenant、提升 visibility、扩大来源或改变工具能力。`confidence` 只触发裁决/诊断，不能覆盖 Host 安全规则；系统不得用固定置信阈值把普通 discovery 问题批量拒答。`clarify` 返回明确的歧义说明和最小澄清问题，不伪装成资料不存在。

Known 与 Unknown 必须明确分离。例如 `2022 到 2024 年你在哪家公司工作` 的 Known 是 `subject=profile_owner` 与 time range，Unknown 是 company，属于 discovery；`我在富途期间负责什么` 的 Known 还包括 required organization `富途`，Unknown 是 responsibilities，属于 focused。时间范围只约束 Evidence 适用性，不作为回答方面；Requested Field 才形成有序 `answerAspects`。

Query Understanding Agent 最终语义通过 Host 校验后、任何 Embedding 或检索前必须执行 Entity Resolution：

- Entity Catalog 只能读取当前 owner、caller mode、publication、visibility、source state、active revision 允许的 Repository 与有 Evidence 绑定的 Knowledge Item；Public Chat 不得通过“实体不存在”泄露 private/agent-only 实体的存在；
- canonical name 与 alias 使用 NFKC、大小写、空白和稳定分隔符规范化做精确映射；`one cat` 可以解析为已声明 alias `OneCat`，但 `askme` 不能 nearest-neighbor 成 `onecat`；
- Entity Resolution 只消费 `role=required` 的 Named Entity Mention。没有 Required Entity 的 discovery 问题中 Entity Gate 不得停止检索，Entity Scope 为 null，系统从当前全部授权来源检索 requested fields；
- 一个显式 project/product/repository/organization/person 实体在授权 Catalog 中不存在时，系统不得执行无范围向量检索。若它是唯一核心实体，直接返回 `none` 和该用户已提供名称的安全缺口；
- 多实体问题中，已解析实体仍可在其 Entity Scope 内形成 `partial` 回答，未解析实体必须作为显式缺口，不能把已解析实体的事实复制给它；
- 会话中的“它/该项目/that project”等指代只从同一 Conversation 上一轮 Retrieval Trace 已解析的实体焦点恢复，并用当前 Catalog 重新授权；只有上一轮恰好一个仍授权的 resolved entity 且不存在 missing/ambiguous mention 时才继承，零个时为 unresolved，多个实体或 resolved 与 missing/ambiguous 并存时均为 ambiguous。Agent 对原始聊天文本的 contextual 猜测不得覆盖该 Host 结果，歧义时不检索、不猜测并返回明确缺口。

### 6.2 多路召回与融合

授权过滤与 Entity Scope 硬约束后默认并行执行：

| Route | 默认 TopK | RRF weight |
| --- | ---: | ---: |
| exact phrase/entity | 20 | 1.5 |
| PostgreSQL FTS + `pg_trgm` lexical | 30 | 1.0 |
| pgvector exact cosine | 30 | 1.0 |
| Knowledge Item / structured fields | 20 | 1.2 |

系统使用 weighted RRF，默认 `k=60`。所有 TopK、weight、RRF k、阈值和每 Parent Child 数都必须配置化。候选按 stable ID/checksum 去重，默认同一 Parent 最多保留三个 Child。

Knowledge Item 只作为检索锚点；命中后必须展开到 `knowledge_evidence` 对应的 Material Child。未经来源支撑的 Candidate 编辑不能独立成为最终 Claim Evidence。Approved Wiki 可以作为最终 Evidence，但必须保留 Host 验证的 `[S*]` 原始来源血缘。

Entity Scope 约束适用于 exact、lexical、vector 和 structured 四条 Route，必须在排名前执行。命中一个实体 alias 只证明 identity，不证明问题中的具体事实；检索结果仍需通过 Rerank、Answerability 与 Claim Verifier。

Query Semantics 必须实际参与检索，而不是只写入 Trace：Knowledge Scope 和 Requested Fields 为 exact/lexical/semantic/structured 查询提供受控职业同义词，time range 保留原始年份/月并进入 standalone/semantic query；desired evidence type 必须限制对应 source kind，不能由 Agent 选择未授权来源。Knowledge Scope 只影响相关性和 evidence type，不在 discovery 问题中制造 source hard scope。时间条件不得写成 `document.start == query.start AND document.end == query.end`；能识别出 Evidence 任职区间时使用 `document.start <= query.end AND document.end >= query.start`，无法确定区间的 Evidence 交给 Answerability 判定，不因解析器未知而伪装成 none。

## 7. Rerank、Evidence Pack 与有界补检

RRF 候选交给独立 Rerank Provider，默认模型为 `qwen3-rerank`。Rerank 与 Chat LLM 必须使用独立 Profile、配置、超时、重试和 usage 记录；允许部署者显式复用同一上游 API key，但不能共享行为状态。

Evidence fusion 必须遵守：

- 同一 `evidence_family` 只计一份独立证据，不能因原始材料、Knowledge Item 和 Wiki 重复出现而提高置信度；
- 来源互相矛盾时输出 `conflicted`，同时保留冲突双方 Citation，不按来源类型或时间静默覆盖；
- Evidence Pack 的默认 hard ceiling 为 `200,000 tokens`，不是填充目标；覆盖充分时提前停止；
- effective budget 是配置上限与 `model context - system - conversation - output reserve - safety margin` 的较小值；
- 每次记录 configured/effective/actual evidence tokens。

Evidence Judge 只输出 `full | partial | none | conflicted`，并将 Entity Resolution 结果作为高优先级 Host 信号；RAG runtime 在 Coverage 之外使用 `refused | failed` 表达安全拒绝和系统故障：

- `full`：核心方面均有充分 Evidence；
- `partial`：只回答被支持方面，并明确列出不支持方面；
- `none`：核心方面均无支持；
- `conflicted`：一个或多个核心事实存在不可消解冲突；
- `refused`：权限、publication、滥用或安全门禁拒绝，不属于 Coverage；
- `failed`：Provider、Answer、Citation 等系统失败，不属于 Coverage。

`conflicted` 只表示同一实体、同一问题方面和同一可比较事实存在互斥 Evidence；不得因为某段 Evidence 含任意“不是/没有/not”字样，或同一实体在多篇文档中出现，就把项目介绍、职业时间线等问题判为冲突。Rerank 高分只能支持 topic relevance，不能覆盖 missing entity 或扩大 Entity Scope。

初检不完整时，Judge 可以基于 unsupported aspects 产生一次定向补检。一个问题最多两轮检索；补检不得扩大授权来源，结果必须与第一轮去重。第二轮失败后只能基于第一轮输出 partial/none，不能无界重试。

Host 必须从 Requested Fields 把用户当前问题拆成有稳定顺序和 ID 的显式回答方面。复合问题中的公司、职位、任职时间、职责、成果等待求字段不能因检索已命中部分内容而被合并或遗漏；Subject、Knowledge Scope 和 time range 等 Known constraints 不是 answer aspect。每个方面最终必须由至少一个已验证 Claim 回答，或明确显示当前授权 Evidence 不支持该方面。检索词命中率不能替代问题方面覆盖。

Answerability Gate 必须在生成前证明：至少一个 Requested Field 有当前授权范围内的直接 Evidence；有 Required Entity 时 Evidence identity 必须与它一致，discovery 问题中 Evidence 的 company/project 等可以作为 Requested Field 的答案，不能反过来判成 entity mismatch。Context mention 不得被重命名成回答主体，也不得无故排除其他有效 Evidence。存在 time range 时，支持任职记录的 Evidence 必须与查询区间重叠；一个记录的 `start <= query.end AND end >= query.start` 即可命中，不能要求端点相等。唯一核心 Required Entity 缺失、clarify 或所有待求字段均不支持时不得调用 Answer Generator；系统分别以普通 `insufficient_evidence`、带 `query_clarification_required` reason 的 `insufficient_evidence` 或 `failed` 表达，Trace 和用户文案必须能区分真实资料缺口与需要澄清。Generator Prompt 与最终 Host 校验继续作为 defense in depth，明确禁止实体替代。

## 8. Claim 验证与 Citation

Answer Generator 必须先生成结构化 coverage、claims、aspectId、evidenceIds 和 `unsupportedAspectIds`。Host 先校验每个 `aspectId` 属于当前问题、每个 evidence ID 的 owner、visibility、active version、checksum 和来源状态，再交给独立 Claim Verifier。

每次回答在请求开始时冻结一个由 Host 时钟产生的 `YYYY-MM-DD` 当前日期，并作为受信任的时间上下文传给 Answer Generator。模型不得根据训练截止时间、历史 Prompt 或 Evidence 猜测当前年份；工作年限等相对时间只能由 Evidence 中的起止时间与该 Host 日期计算。若用户明确询问工作年限，且独立 Verifier 已确认的 Claim 含明确职业起点，Host 必须用冻结日期重新计算并渲染持续时长，不能因模型只复述起点而遗漏年限，也不能发布模型给出的过期当前年份。Host 日期不构成职业事实 Citation，计算结果仍必须引用提供起止时间的 Evidence。

Claim Verifier 只读取该 Claim 引用的 Evidence subset，输出 `entailed | partially_entailed | unsupported | contradicted`。Host 删除 unsupported/contradicted Claim，收窄 partially_entailed Claim，最多允许一次受控修复。最终 Markdown 由 Host 渲染；Citation Validator 失败时不得持久化或输出无 Citation 替代答案。

Host 只接受已声明问题方面的 Claim，并按原问题方面顺序渲染最终 Markdown。Verifier 删除或收窄 Claim 后，Host 必须重新对账方面覆盖；没有有效 Claim 的方面转为明确的 Evidence 缺口。相同或近似相同的 Claim 不得在同一回答中重复发布；无法安全合并的语义重复必须以稳定回答质量错误失败，不能把重复内容伪装成完整回答。

Citation 形态：

- Material：Material/Child ID 与稳定 checksum；
- Repository Markdown：`repository/path@full_commit_sha#Lx-Ly`；
- Repository PDF：`repository/path@full_commit_sha#page=N`；
- Approved Wiki：section 与 Host 验证的 `[S*]` Repository source range。

Candidate/Public Citation 统一打开 Askme 内部稳定阅读页，并在每次读取时重新授权。Public GitHub Repository 可以附加外部源链接；private Repository 不得暴露 GitHub Token、临时 clone URL 或未批准内容。

## 9. 权限、Prompt Injection 与强撤销

owner、account status、publication、visibility、source state、active revision、index version 和已解析 Entity Scope 过滤必须发生在 exact、FTS、trigram 和 vector 排名之前。任何 LLM、Embedding、Rerank 或 Repository 内容不能扩大该集合。

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

实现级源码问题在文档 RAG 无法回答且 Entity Resolution 与确定性源码意图共同唯一确定一个授权 Repository 时，可以进入现有 `deep` 路由。Entity Resolution 已要求停止的 unknown/ambiguous 请求由 Host 直接留在 RAG 回答层形成 `insufficient_evidence`，不得再调用 Router，也不得被 Router 改写为拒绝或 Deep。每个 Deep Analysis Run 只读取一个成功同步的不可变 Revision，在新的临时 BoxLite microVM 内运行只读工具；不得写 Repository、执行项目代码、安装依赖、访问网络或加载 Repository 自带指令。

Deep run 的 `pending | running | completed | failed | cancelled` 与回答 outcome 分离。最终回答和 Host 验证 Citation 可以进入会话；reasoning、工具逐步输出、临时分析文件和中间结论不得持久化或进入 RAG。Deep 失败必须显示真实失败，不得伪装成 RAG none。

多 Repository 无法唯一确定时必须要求用户选择，不猜测、不并行启动多个 sandbox。SSE 只发送 run id、version、状态和完成提示，不泄露源码、reasoning 或 Secret。

## 11. Provider、配置与降级

系统使用可独立配置的 Query Understanding Agent Chat、Embedding、Rerank、RAG Answer、Claim Verifier 与 Code Agent Profile。模型名、base URL、API key、timeout、retry、token/context budget 和 provider compatibility 均由受控配置读取，Secret 不进入日志、Trace、数据库、文档或 Commit。

默认降级：

- Query Understanding Agent 失败：确定性 Query Semantics；
- Embedding 失败：exact + lexical + structured；
- Rerank 失败：使用 RRF，Evidence Judge 提高充分性要求；
- 第二轮失败：第一轮 partial/none；
- Answer 或 Claim Verifier 失败：显式 failed；
- Citation Validator 失败：拒绝输出。

模型能力可以降级，Evidence 与权限边界不能降级。Candidate 能看到 `basic retrieval mode` 等安全状态提示。

## 12. Retrieval Trace 与反馈

Candidate/Admin 可以查看一次问答的 Retrieval Trace：

- retrieval policy、active index、source revision/commit；
- Query Understanding Agent 的 intent、subject、query mode、knowledge scope、entity role、requested fields、safe constraints、confidence、adjudication 与 entity mentions，Host 的 resolved/missing/ambiguous 结果、Entity Scope 来源数、关键词和 semantic queries；
- exact/lexical/vector/structured 各路命中数；
- RRF/Rerank 后的 evidence ID、分数和筛选原因；
- Coverage、补检、降级、跳过、权限过滤与索引告警。

Trace 不向 Interviewer 展示，不包含 system prompt、Embedding vector、未授权正文或 Provider 敏感原始错误。

点赞、点踩和 Candidate 纠正只作为离线评估标签。它们不能在线修改 RRF 权重、Knowledge Item、Evidence、Embedding 或模型。任何检索策略变化必须产生新的 `retrieval_policy_version` 并重新通过发布门禁。

## 13. Golden Dataset 与发布门禁

仓库内维护完全合成、无真实个人信息的三名虚构 Candidate 材料、既有 120 个检索问题、至少 12 个独立实体混淆回归 case，以及至少 18 个无实体/显式实体成对的 Query Semantics case：

| 类型 | 数量 |
| --- | ---: |
| 精确事实 | 30 |
| 中文改写 | 25 |
| 中英混合/缩写 | 15 |
| 多轮指代 | 15 |
| partial | 15 |
| none | 10 |
| 权限/越界 | 10 |

材料覆盖全部 visibility、Material/Knowledge Item/Approved Wiki/Repository Markdown/PDF、重复血缘、冲突、长文档、Prompt Injection 和 Provider 降级。实体集至少覆盖：已知项目、未知相似项目、无类型显式 Alias、canonical/alias、大小写与分隔符变体、短 Alias 嵌套、同名歧义、多实体 partial、唯一会话指代与多实体指代歧义。Query Semantics 成对集至少覆盖“Askme 是什么/做过哪些项目”“富途期间做什么/2022–2024 在哪家公司”“未知公司期间做什么/有哪些工作经历”“看过 Askme 后还做过哪些项目/Askme 还包含哪些项目”，以及 company、job title、responsibilities、project、skill、time overlap、profile owner、incidental entity、LLM/seed disagreement 和 Provider fallback。每个 case 标注 expected semantics、entity role、entity resolution、outcome、coverage、required/forbidden evidence IDs、可选 acceptable Citation IDs 和 tags；required ID 用于 Recall，Citation precision 接受所有能直接支持目标 Claim 且未被禁止的标注证据。

发布门禁必须区分三类 Evidence：

1. 离线合成检索评测必须调用生产 Query Analyzer、Entity Resolver、scope filter、RRF、Evidence Pack/Coverage 等真实核心函数；不得用 case tag、问题关键词或硬编码 outcome 直接生成预测结果；
2. 配置 Provider 的隔离评测必须在真实 PostgreSQL 与真实 Query Understanding Agent、Embedding、Rerank、Answer、Verifier 上运行至少 12 个覆盖 focused/discovery/clarify、已知/未知实体、incidental mention、多实体、别名、会话指代、权限和 Provider 降级的 case，校验 semantics、outcome、关键事实、Entity/Citation 和授权边界，不以逐字答案作为 gold；
3. 当前本地真实账号的 Candidate Preview 与 Public Chat 只用于非持久最终验收，问题与材料不进入仓库 fixture。

本合同发布必须满足：

- initial Recall@30 `>=95%`；
- rerank evidence Recall@8 `>=90%`；
- Citation precision `=100%`；
- answerable 被误判 none `<=5%`；
- unanswerable 虚构回答 `=0`；
- 未授权泄露 `=0`；
- outcome classification `>=95%`。

指标必须按语言、来源、问题类型、实体解析结果和降级模式分段。任何只运行自定义打分器、未进入生产组件或未调用真实 Provider 的结果，都不得声称证明真实 outcome、幻觉率或端到端 Citation precision。

## 14. 验收标准

- [x] `AC-RAG2-001` 中文精确问题、改写和中英混合问题均能召回富途等完整任职 Parent/Child，不再因连续中文 lexeme 导致零召回。
- [x] `AC-RAG2-002` Material、Knowledge anchor、Approved Wiki 和 Repository 文档经过 exact/lexical/vector/structured、RRF 与独立 Rerank，且所有 TopK、权重、阈值和 evidence budget 可配置。
- [x] `AC-RAG2-003` pgvector 使用固定 1024 维 Embedding version、过滤后 exact cosine 和原子 active index；重建派生索引不删除业务数据，也不混合不同版本。
- [x] `AC-RAG2-004` Parent–Child 切分遵守结构、token、上下文和范围约束，简历公司/岗位/职责不会失去关联。
- [x] `AC-RAG2-005` Evidence Judge 正确区分 full、partial、none 和 conflicted，RAG runtime 独立区分 refused 与 failed；冲突必须绑定同一可比较事实，最多进行一次不扩大权限或 Entity Scope 的定向补检。
- [x] `AC-RAG2-006` Claim Verifier 删除或收窄无支持/矛盾 Claim，Citation Validator 只允许当前授权、active、checksum 有效的 Evidence。
- [x] `AC-ANSWER-001` 工作年限和其他相对时间使用请求开始时冻结的 Host 当前日期计算，不再由模型猜测当前年份；计算结果引用包含起止时间的授权 Evidence。
- [x] `AC-ANSWER-002` 复合问题的每个显式方面均由已验证 Claim 回答或明确披露 Evidence 缺口，最终 Markdown 按问题顺序组织且不发布相同或近似相同的重复 Claim。
- [x] `AC-RAG2-007` Embedding、Rerank、查询理解 Provider 和第二轮失败按合同安全降级；Answer/Verifier/Citation 失败不伪装成“证据不足”。
- [x] `AC-REPO-DOC-001` Repository 级批准后，白名单内当前和未来 Markdown/PDF 自动索引并继承 visibility；源码与扫描 PDF 不进入 Embedding。
- [x] `AC-REPO-DOC-002` Repository sync 与 index readiness 独立可见，超限/不支持文件产生 ready_with_warnings 和稳定原因，新索引失败不混用 commit。
- [x] `AC-REPO-DOC-003` Repository Citation 固定完整 commit、path、line/page 和 checksum；Askme 阅读页实时授权，权限降低执行强撤销。
- [x] `AC-EVIDENCE-001` Evidence family 防止派生副本重复增信；冲突来源不静默覆盖并同时显示双方 Citation。
- [x] `AC-SEC-RAG-001` Prompt Injection、Repository 指令和恶意材料不能改变权限、Prompt、Provider、工具或检索范围，未授权泄露为零。
- [x] `AC-TRACE-001` Candidate/Admin 能查看不含敏感正文和向量的 Retrieval Trace，Interviewer 不可访问。
- [x] `AC-FEEDBACK-001` 用户反馈只进入离线标签，策略改变以新 retrieval policy version 通过门禁后发布。
- [x] `AC-ENTITY-001` Material Knowledge 与 Repository 身份形成按当前 caller 授权投影的 Entity Catalog；canonical name/alias 均有 Evidence/source 绑定，Public Chat 不泄露未授权实体。
- [x] `AC-ENTITY-002` 显式实体在 rewrite 后仍保留；已解析实体在四路检索前执行硬 source scope，唯一未知项目直接 `none`，多实体只回答已支持部分且不发生实体改名。
- [x] `AC-ENTITY-003` Entity canonical/alias、无类型显式 Alias、大小写/分隔符变体、短 Alias 嵌套、同名歧义、唯一会话指代和多实体指代歧义均有回归；未知 Askme 不召回或回答 OneCat，已知 OneCat 仍能正常回答。
- [x] `AC-EVAL-001` 合成 Golden Dataset 调用生产核心组件且达到召回、排序、权限和实体门禁阈值；真实 PostgreSQL/Provider 评测独立证明 outcome、Claim/Citation、未知实体与降级行为。
- [x] `AC-REBUILD-001` 未上线环境可通过单一维护入口重建 Knowledge organization 与全部派生 RAG 数据，激活唯一新 index；账号、原始材料、Repository、权限、Publication 和会话计数不因重建丢失。
- [x] `AC-TRACE-002` Retrieval Trace 记录安全的 entity mention、resolved/missing/ambiguous、scope 与 gate reason，能够解释“为何回答/为何拒答”，且不向 Visitor 暴露或泄露私有实体。
- [x] `AC-ACCEPT-003` 真实 Compose、真实 Provider、Candidate Preview 与 Public Chat 通过已知实体、未知相似实体、多实体 partial、权限隔离、Citation、Trace、持久化和浏览器 Console/Network 验收。
- [x] `AC-ACCEPT-002` 保留业务数据部署后，目标账号的富途经历和已批准 Repository 文档问题在真实浏览器返回正确回答、有效 Citation 和可解释 Trace。
- [x] `AC-QUERY-001` `我/你/本人/候选人/这个人` 在 Candidate Preview 与对应 Public Agent 中解析为 `profile_owner`；问词、代词、待求字段和不完整问句不会进入严格 Entity Resolution。
- [x] `AC-QUERY-002` discovery 的经历、项目、技能和教育问题继续检索授权知识；required 已知实体执行 source hard scope，required 未知或歧义实体继续安全 none/partial，context mention 不错误缩小范围，不在防幻觉与过度拒答之间回摆。
- [x] `AC-QUERY-003` LLM Query Understanding Agent 结合当前问题、受控会话、Host seed、Catalog candidate 与可信上一轮 Trace，稳定区分 intent、subject、query mode、entity role、constraints 与 requested fields；一次条件语义裁决和 fallback 不能删除 Required Entity、制造实体或把 Known constraint 与 Unknown field 互换。
- [x] `AC-QUERY-004` `2022–2024`、单年和年月范围按 inclusive interval overlap 判断任职 Evidence；time range 不成为 answer aspect，公司、职位和职责分别获得已验证 Claim 或明确缺口。
- [x] `AC-EVAL-002` 至少 18 个无实体/显式实体成对回归 case 通过生产 Query Understanding 与 Entity Resolver；真实 PostgreSQL/Provider 和 API 验证目标问题有正确 outcome、关键事实、Citation、Trace 与权限边界。
- [x] `AC-ACCEPT-004` 保留业务数据重建并部署后，Candidate Preview 与 Public Chat 在真实浏览器正确回答目标富途时间经历和无实体项目问题，同时保持 Askme/OneCat/未知实体门禁、会话、来源和 Console/Network 健康。
- [x] `AC-QUERY-005` 批准的成对 Query Semantics 回归集中，required-entity role 假阳性、required entity 漏识别、无实体 false-none 和跨实体替代均为 0；范围外开放语言不声称数学上绝对零错误，新增失败必须进入可复现 eval 后才能调整策略。

## 15. 已批准的延迟项

OCR、HNSW 默认启用、其他 Git provider、跨 Repository Deep Analysis、原始源码 Embedding、在线训练、自动反馈调权、计费和生产多 Region 不阻塞本合同。HNSW 只有达到本合同容量/延迟阈值并通过 recall 对照时才可提前启用。
