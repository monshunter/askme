# DESIGN-005：成熟 Entity-grounded RAG 与隔离源码分析系统设计

Boundary ID：`askme-entity-grounded-rag-runtime-v3`

Owner boundary：满足 [SPEC-002](../specs/SPEC-002.md) 的版本化索引、Repository 文档、混合检索、有界 Agent、Citation、权限、观测与隔离源码分析架构。

Status：`active`

当前修订 Plan：[PLAN-025](../plans/PLAN-025.md)

## 1. 目标、现状与不变量

Askme 继续使用 Next.js、PostgreSQL、Node worker、Docker Compose 和现有 Repository Artifact/Code Agent Runtime。当前 V2 已统一承载 Material、Knowledge anchor、Approved Wiki 与已批准 Repository Markdown/PDF，并完成四路召回、RRF、Rerank、Evidence Judge、Claim Verifier 与 Citation Validator。本修订在同一运行时增加 Entity-grounded preflight、检索前 source scope、实体上下文化索引和可信评测，不建立平行 RAG。

当前实现的关键差距：

- Planner 能输出 `entities`，但系统没有按当前 caller 授权投影的 Entity Catalog，也没有在 Embedding 前解析 canonical/alias 或执行 source hard scope；
- 当前 Askme/OneCat 修复发生在检索后的字面量/Rerank threshold，未知实体仍会先召回无关 Evidence，不能成为通用身份模型；
- contextual Child 只有 source title 与 section，没有 Material Knowledge 或 Repository canonical entity/alias；
- `conflictDetected` 只要同一宽泛 signal 出现在两个 family 且任意正文含否定词就返回 conflicted；真实 Trace 中 40 次查询有 20 次 conflicted，OneCat 项目介绍等正常问题被系统性误判；
- 120 题脚本用 case tag 与关键词直接推导 coverage/outcome，没有执行生产 Entity Resolver、数据库检索或 Answer/Verifier，不能证明真实幻觉率和 outcome；
- 已有真实 Compose smoke 覆盖索引、四路召回、Citation 与撤销，但没有覆盖真实 Planner → Entity → Answerability → Answer → Verifier 的隔离评测。

系统不变量：

1. Host 在检索前确定 owner、caller mode、publication、visibility、source state、active revision、active index 和 Entity Scope；任何模型不能扩大集合。
2. 原始业务数据与派生知识/检索数据分离。项目未上线，Knowledge Item organization 与 RAG index 可以全量重建；维护入口不能删除账号、原始 Material/Artifact、Repository、权限、Publication 和会话。
3. 一个查询只使用一个 active index version；Embedding model、dimension、prefix 或 chunking 不同的向量不得混合。
4. Repository 文档索引只读取成功同步的不可变 commit；原始源码仍只进入一次性只读 Deep Analysis。
5. 所有来源正文、对话历史和 Repository 指令都是不可信数据，不能改变 system contract、权限或工具。
6. Answer 生成、Claim 验证、Citation 校验与消息持久化是分离边界；任何一步失败都不能发布未验证 Claim。
7. 权限撤销立即作用于 active 检索与历史 Citation；延迟 GC 不等于延迟授权。
8. Entity identity 与 semantic relevance 分离：Catalog exact alias 决定“是谁”，Hybrid/Rerank/Answerability 决定“哪些 Evidence 能回答什么”。

## 2. 关键选型与权衡

| 决策 | V2 选择 | 理由 | 未选择 |
| --- | --- | --- | --- |
| Vector store | 同一 PostgreSQL 18 + pgvector | 复用 tenant filter、事务、迁移、备份和运行入口 | Milvus、Qdrant、DashVector、独立向量服务 |
| Vector search | 过滤后的 exact cosine | 初始规模下 perfect recall，避免 ANN filter 漏召回 | 默认 HNSW/IVFFlat |
| Chunk | structure-first Parent–Child | 小 Child 提升召回，Parent 保留完整职业/文档上下文 | 固定字符窗口、句子碎片 |
| Fusion | weighted RRF + independent rerank | 词法/向量分数量纲不同，RRF 稳定；Rerank 独立优化回答相关性 | 直接加权原始分数、Chat LLM 排序 |
| Entity Catalog | `Knowledge Item.entities + knowledge_evidence + Repository record` 的实时授权投影 | 复用现有事实 owner，按 caller 过滤，不产生人工维护的第二知识库 | 独立通用 Knowledge Graph、向量 nearest-entity、静态全 tenant registry |
| Entity matching | canonical/alias 确定性规范化精确映射 | proper noun 身份可解释、可 hard filter、可拒答 | 用 cosine/rerank 猜实体 |
| Agent | Host 编排的最多两轮 bounded workflow | 保持权限、延迟和失败可控 | 自由工具循环、无界自反思 |
| Answerability | Host entity gate + 一次结构化 Verifier-profile Evidence Gate | 生成前确认方面/实体/证据，冲突绑定具体 Evidence | 仅凭宽泛词命中或任意否定词、让 Generator 自行决定是否可答 |
| Claim grounding | 结构化 Claim + 独立 Verifier + Host validator | 模型不能同时担任唯一生成者和裁判 | 只靠 Prompt 要求引用 |
| Repository 文档 | approved Repository 的 Markdown/PDF 进入相同索引 | README/docs 是直接、可引用的职业项目证据 | 只检索派生 Wiki、源码全量 Embedding |
| Feedback | 离线标签 + versioned policy | 可评估、可回滚，不形成线上自修改闭环 | 点踩自动调权、自动改 Knowledge |

pgvector 官方支持 exact/approximate、cosine 与 PostgreSQL filter；本地 Compose 使用已验证存在的 `pgvector/pgvector:pg18` 镜像，并由 migration 执行 `CREATE EXTENSION IF NOT EXISTS vector` 与 `pg_trgm`。

## 3. 系统上下文

```mermaid
flowchart LR
  C["Candidate / Visitor"] --> W["Next.js Web"]
  W --> O["RAG Orchestrator"]
  O --> P[("PostgreSQL + pgvector")]
  O --> EC["Authorized Entity Catalog"]
  O --> ER["Entity Resolver"]
  O --> QP["Query Planner Chat"]
  O --> E["Embedding Provider"]
  O --> RR["Rerank Provider"]
  O --> AG["Answer Generator"]
  O --> AJ["Answerability Gate"]
  O --> CV["Claim Verifier"]
  IW["Index Worker"] --> P
  IW --> E
  IW --> FS[("Uploads / Repository Artifact")]
  RS["Repository Sync"] --> FS
  RS --> P
  DR["Code Agent Runner"] --> P
  DR --> BX["One-run BoxLite"]
  BX --> FS
```

Web 负责同步命令、问答 API、Candidate/Admin Trace 和 Citation projection。Worker 负责材料/Repository 文档解析、Parent–Child、Embedding、索引激活和失败 reconcile。普通 RAG 不启动 BoxLite；只有实现级源码问题经过既有 deterministic gate 后创建 `conversation_analysis` run。

## 4. 组件与依赖方向

| 组件 | 单一职责 |
| --- | --- |
| `RagConfig` | 解析、校验并隐藏 Provider、TopK、RRF、token budget、chunk 和 Repository 文档默认值 |
| `EmbeddingProvider` | 批量把版本化 contextual text 转为固定 1024 维向量，校验数量、维度和 finite number |
| `RerankProvider` | 对一个 query 的候选正文返回请求内相对排序，不跨请求比较 score |
| `StructureChunker` | 解析 source structure，生成 Parent、Child、原始范围、stable checksum 和 contextual prefix |
| `KnowledgeOrganizer` | 从每个 Material 的实际 Evidence 生成 Knowledge Item，并附带 typed canonical entities/aliases |
| `AuthorizedEntityCatalog` | 从当前 allowed Material 的 evidence-bound entities 与当前 allowed Repository record 投影 canonical/alias/source refs |
| `IndexCoordinator` | 创建 index/source version、调度 job、原子激活、失败保持旧 active、强撤销和 GC |
| `RepositoryDocumentCollector` | 在 immutable artifact 内按 allowlist/glob/容量发现并提取 Markdown/PDF 文本 |
| `DeterministicQueryAnalyzer` | Unicode、中文片段、CJK n-gram、显式 entity mention、精确短语、混合语言与会话指代 seed |
| `QueryPlanner` | 输出受 schema 约束的 standalone query、typed entity mentions、terms、semantic queries 和 evidence type；Host 保留原问题实体与 answer aspects |
| `EntityResolver` | 将 mention 精确映射到 Authorized Entity Catalog，输出 resolved/missing/ambiguous 与 Material/Repository scope |
| `HybridRetriever` | 在同一授权集合和 Entity Scope 内并行执行 exact、lexical、vector、structured并返回 route ranks |
| `RrfFusion` | 按配置化 weight/k 合并、stable dedup、Parent 限流和 evidence-family 标记 |
| `EvidenceJudge` | 用确定性 provisional coverage 驱动唯一补检，不再用任意否定词宣称冲突 |
| `AnswerabilityGate` | 最终一次读取问题方面、Entity Resolution 与 Evidence，输出 supported/unsupported/conflicted aspect 和 evidence IDs；失败为系统错误 |
| `AnswerGenerator` | 输出结构化 claims/evidenceIds，不拥有授权或最终 Markdown |
| `ClaimVerifier` | 只对每条 Claim 的引用 Evidence 判断 entailment/contradiction |
| `CitationValidator` | 重新读取 active/auth/checksum，校验 Claim-Citation，Host 渲染最终 Markdown |
| `RetrievalTraceStore` | 保存安全 metadata、route count/rank/outcome/degradation，不保存向量或未授权正文 |

依赖只能从 Orchestrator 指向 Provider/Repository interface；Provider 不访问数据库，模型输出不直接写消息，Repository Collector 不修改 artifact。

## 5. 持久数据模型

### 5.1 `knowledge_items.entities` 与授权 Catalog 投影

Migration 为 `knowledge_items` 增加非空 `entities jsonb`，应用 schema 为：

```text
entities[] = {
  type: person | organization | project | product | repository | technology,
  canonicalName: string,
  aliases: string[]
}
```

Organizer 只允许从该 Knowledge Item 已声明的 `evidencePositions` 提取实体；canonical/alias 都必须在 Evidence 中出现，或属于大小写、空格、连字符、Repository namespace 等确定性格式变体。每 Item 最多 12 个 entity，每 entity 最多 8 个 alias，禁止把“项目定位”“核心功能”“平台”等通用概念作为 identity。

不创建 `rag_entities` 或 `rag_entity_links` 表。`AuthorizedEntityCatalog` 在每个 query 开始时用一组只读 SQL 投影：

- Material entity：`knowledge_items.entities → knowledge_sources → materials`，要求 Item active、Material indexed、当前 visibility 对 caller 可用；source refs 是关联 Material IDs；
- Repository entity：`repositories.display_name + canonical_url namespace/name + basename`，要求 Repository 未 disabled、visibility 对 caller 可用；source refs 是 Repository ID；
- Public caller 的查询根本不读取 private/agent-only rows，因此 missing 结果只表示“当前公开授权知识没有该实体”，不暴露 Candidate 私有 Catalog；
- projection 在同一请求内冻结，normalized alias 映射到一个或多个 entity key；一个 alias 指向多个不同 entity key 时状态为 ambiguous，不做 union 猜测。

`normalizeEntityAlias` 使用 NFKC、locale-stable lowercase、Unicode 空白折叠，并移除空格、`- _ . /` 等稳定分隔符用于匹配；原始 canonical/alias 仍保留给 Trace 和上下文。Repository entity key 使用现有 Repository ID；Material entity 默认使用请求内 `sha256(type + normalizedCanonicalName)`。若一个 Material project/repository entity 的 canonical/alias 精确命中唯一授权 Repository，它的 Material source refs 合并到该 Repository entity；命中多个 Repository 时保持 ambiguous。这样同一 OneCat 的简历与 Repository 可以统一 scope，不同 namespace 下同名 Repository 仍不会被错误合并。

### 5.2 `rag_index_versions`

全局索引配置 owner：

| 字段 | 语义 |
| --- | --- |
| `id` | UUID |
| `state` | `building | ready | active | failed | superseded` |
| `chunking_version` | StructureChunker 合同版本 |
| `embedding_provider/model/dimensions` | 默认 Qwen/`qwen3.7-text-embedding`/1024 |
| `context_prefix_version` | contextual prefix 版本 |
| `distance_metric` | `cosine` |
| `created_at/activated_at/failure_code` | 生命周期与安全错误 |

全库同一时间只有一个 active index version。新配置重建在独立 version 下完成；只有全部要求的 source versions ready 且 Golden gate 可执行时才切换 active。首次 V2 migration 不保留 V1 query path，但仍用此机制保证重建失败不会产生半成品检索。

### 5.3 `rag_source_versions`

统一表示一个可索引来源 revision：

| 字段 | 语义 |
| --- | --- |
| `owner_id` | tenant filter |
| `source_kind` | `material | approved_wiki | repository_markdown | repository_pdf` |
| `source_id` | Material、Wiki page 或 Repository id |
| `source_revision` | material checksum、projection checksum 或 `commit:path:content_hash` |
| `index_version_id` | 所属 global index version |
| `state` | `queued | processing | ready | ready_with_warnings | failed | revoked` |
| `visibility` | 入库快照，仅用于诊断；查询仍 join 当前业务 owner |
| `evidence_family_id` | 原始/派生血缘 |
| `metadata` | title、path、commit、page/line、warning 等安全 JSON |
| `parent_count/child_count/token_count` | readiness 与观测 |

逻辑 source + index version + revision 唯一。Repository 文档的 `source_id` 使用 Repository id，`source_revision` 固定 commit/path/checksum；查询必须 join `repositories.active_revision_id`，不能只信 metadata。

### 5.4 `rag_parent_chunks` 与 `rag_child_chunks`

Parent 保存原始完整上下文、token count、structure path、source range 和 checksum。Child 保存 parent id、position、原始文本、contextual text、token count、`tsvector`、trigram 可检索正文和 `vector(1024)` embedding。contextual text 由 `Source + Entities + Section + raw child` 组成：Material entity 来自当前 organization，Repository entity 来自 Repository record；它不写回原文或 Citation。所有表重复保存 `owner_id + index_version_id + source_version_id` 以允许数据库约束和先过滤后排序；foreign key 必须阻止跨 owner 关联。

Child stable key 由 `source_revision + structure_path + normalized_range + content_checksum` 计算，不以数组 position 作为跨重建身份。Knowledge Item structured route 先读取现有 `knowledge_sources/knowledge_evidence`；V2 重建后由 `knowledge_sources` 将 anchor 重新绑定到该 Material 的 active Child，不把 Candidate summary 复制成最终 Evidence。

V1 `chunks`、其 search vector 和派生 `knowledge_evidence` 可以在 V2 build 成功后清空或退出读取路径；已有 Message/Conversation 保留。无法重建的历史 V1 Citation 标记 `evidence_revoked`，不级联删除消息。

### 5.5 Trace 与反馈

`rag_query_traces` 保存 conversation/message、caller mode、policy/index version、Planner safe JSON、每 route count、selected evidence IDs/scores、coverage、round count、degradation、token budget 和 latency。Planner safe JSON 增加 entity mentions、resolved/missing/ambiguous canonical name、scope Material/Repository count 与 gate reason，不保存未授权实体或来源 ID 列表。表不保存 question、evidence正文、Prompt 或 vector；Candidate 只能读自己的 trace，Admin API 只返回诊断字段。

`rag_feedback` 保存 message、owner、`up | down | correction`、可选安全标签和 policy version。correction 正文按 Candidate 私有数据处理，但不进入索引或 Prompt，只有离线 eval export 显式读取。

## 6. 索引流水线

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> processing
  processing --> ready
  processing --> ready_with_warnings
  processing --> failed
  ready --> active: source/index activation transaction
  ready_with_warnings --> active: warnings accepted by policy
  active --> revoked: delete/permission downgrade
  active --> superseded: newer revision activated
```

### 6.1 Material / Approved Wiki

Material 继续由现有 ingestion job 提取原始文本。Knowledge Organizer 的严格 schema 在现有 title/summary/highlights/evidencePositions 之外生成 typed entities；Host 在持久化前对 canonical/alias 做 NFKC 规范化，并验证它们出现在该 Item 选择的 Evidence，或只属于大小写、空白、连字符、namespace/basename 等允许格式变体，无法验证的 entity 使本次 organization 以稳定错误失败。`persistIngestionResult` 在同一事务写入 Knowledge Item、entities、`knowledge_sources` 与 `knowledge_evidence`。随后 RAG source worker 重新读取该 Material 的 evidence-bound entity projection，执行结构提取 → Parent/Child → `Source + Entities + Section` contextual text → Embedding batch → source version ready → activation transaction。Knowledge organization 不负责定义 chunk identity，但它拥有 Material entity metadata。

Approved Wiki 以 active projection page 和 H2/H3 section 作为结构输入；每个 section 保留实际 `[S*]` marker 与 Repository source ranges。Wiki 进入 `evidence_family` 后可参与检索，但 RRF/Verifier 优先投影到原始 Material/Repository document；只有 Wiki 的 Host-verified source 能独立引用。新的 projection 批准后，旧 projection 的 Wiki source 必须在同一协调流程中 supersede，随后按非 revoked/superseded source 重算 active index expected count；Repository 文档 readiness 只统计 Markdown/PDF，不能把 Wiki page 混入文件数。

### 6.2 Repository 文档

Repository sync 成功后，Collector 从 content-addressed artifact 读取 manifest，不从 GitHub live branch 拉取。默认 allowlist 与 Candidate include/exclude 使用 `minimatch`；默认安全 excludes 不可被反向 include。

Markdown 解析 heading/list/table/code-fence 边界，并计算源行范围。PDF 复用 `pdfjs-dist` 直接文本提取，按 page/block 记录页码；空文本或质量阈值不达标时标记 `unsupported_no_extractable_text`，不调用 OCR。单文件/页/revision token 预算超限产生 warning 和 skip reason，不截断证据。

Repository 首次处于 private 时可以预建 private index 以缩短后续切换，但检索仍不可使用；最小实现也可以在 visibility 提升时构建。实现必须保证 visibility 是 Repository 级 owner，新增/变化 path 自动继承，删除 path 使旧 source version revoked。

### 6.3 并发与幂等

复用 PostgreSQL job lease + `FOR UPDATE SKIP LOCKED`。幂等键包含 owner、source kind/id/revision、index version 和 extractor/context-prefix version；Provider retry 不创建重复 Parent/Child。一个 source version 只有 lease holder 可以提交 ready；激活事务重新检查当前业务权限与 revision。

Embedding batch 使用配置化并发、batch size、timeout 和 retry；429/5xx 可退避，dimension/schema/invalid-number 是永久失败。旧 active 只有在新 source ready 后 supersede。

`scripts/rebuild-knowledge-rag.ts` 是未上线环境的单一维护入口，默认只输出 dry-run counts，显式 `--execute --activate` 才执行：

1. 对账不存在仍持有 lease 的 Material/RAG job，并记录 users/materials/repositories/publications/conversations/messages 与派生数据计数；
2. 仅把有原始存储的现有 Material ingestion job 重置为 queued，通过现有 lease/processor 重新生成 chunks、Knowledge Item 与 entities；任一 Material 失败则停止，不激活新 index；
3. 用新的 `context_prefix_version=source-entity-context-v2` 创建 building index，收集全部当前 Materials、Approved Wiki 与 Repository documents，幂等处理到 ready；
4. 只有 source count 完整、实体回归和索引 smoke 通过后才原子激活；旧派生 index 进入 superseded，业务事实不删除；
5. 输出前后计数、new index id、source/parent/child/entity count 和稳定失败码，不打印正文或 Secret。相同命令可从当前 job/index 状态恢复。

## 7. Query Planning 与多路检索

```mermaid
flowchart TD
  Q["Question + conversation"] --> G{"Host authorization gates"}
  G -->|deny| RF["refused"]
  G -->|allow| EC["Authorized Entity Catalog"]
  EC --> DQ["Deterministic analyzer + Catalog-first alias scan"]
  DQ --> QP["Structured Query Planner"]
  QP --> CF["Previous Trace entity focus"]
  CF --> ER{"Entity Resolver"}
  ER -->|only missing / ambiguous strict entity| NE["none without retrieval"]
  ER -->|resolved or no strict entity| MR["exact + lexical + vector + structured in scope"]
  MR --> RRF["weighted RRF + family dedup"]
  RRF --> RR["independent rerank"]
  RR --> J{"Provisional Judge"}
  J -->|full or round 2| AJ{"Final Answerability Gate"}
  J -->|partial/none and round 1| RET["one targeted retry in same scope"]
  RET --> MR
  AJ -->|none| NE
  AJ -->|full/partial/conflicted| A["Claim Generator with gated Evidence"]
  A --> V["Claim Verifier"]
  V --> C["Host Citation Validator + render"]
```

### 7.1 Deterministic Query

`DeterministicQueryAnalyzer` 先执行 NFKC、空白/标点规范化、Latin token lowercase、中文短语候选与 2/3-gram、数字/版本/专名保留。它生成 exact phrases、FTS lexemes、trigram probes、semantic seed、可由语法确定的 `entityMentions[]`，以及按原问题顺序编号的 `answerAspects[] = { aspectId, label }`；中文不再通过 `websearch_to_tsquery` 的单个整句 OR 字符串表达。随后 Host 对原始 Query 执行 Catalog-first longest-alias scan：按原始跨度优先保留覆盖同一区间的最长已授权 Alias，使没有类型后缀的 `Askme 怎么样` 仍形成 strict identity，同时避免 `new-api` 内部再命中独立 `api`。单字符 Alias 不参与自动扫描，只能通过带类型确定性语法或 Planner 形成 mention。`answerAspects` 与这两类显式 entity mention 都是 Host contract，不由 Provider 覆盖或删除。

Query Planner 使用独立 Chat Profile 和严格 Zod schema。Planner 输入只包含当前问题、受控会话摘要和 Host 已授权的 source type 列表，不包含未检索正文。每个 entity mention 是 `{ text, type, source: explicit | contextual }`；Host 只接受 explicit text 能在当前原问题中规范化定位、contextual text 能在最近受控上下文定位的项。输出不得携带 SQL、tenant、visibility 或 tool call。Host 将 deterministic mentions 与合法 Planner mentions 合并，并把所有 explicit text 强制附加到 standalone/semantic query；Planner rewrite 不能删除或替换。失败、超时或 schema invalid 时直接使用 deterministic plan。

### 7.2 Entity Resolution 与 Scope

`resolveAuthorizedEntities` 是纯 Host 步骤：

1. 加载一次 Authorized Entity Catalog，并按 normalized alias 建立 map；用 Catalog-first 扫描命中的实体与 Deterministic/Planner explicit mention 合并；
2. 对每个 mention 产出 `resolved | missing | ambiguous | soft`。Catalog-first 命中沿用 Catalog entity type；`project/product/repository/organization/person` 是 strict identity，`technology` 和 `other` 默认是 soft retrieval term；
3. resolved strict entities 合并其 Material IDs 与 Repository IDs 形成 union Scope；多实体比较可以读取各自来源，不能读取其他项目；
4. 任一 strict alias 对应多个 entity key 时 ambiguous；唯一核心 strict mention missing/ambiguous 时直接构造空 retrieval result，跳过 Embedding/Rerank/Answer；
5. resolved + missing 的多实体问题保留 resolved Scope，并把 missing name 绑定到 unsupported aspect，最终 coverage 上限为 partial；
6. contextual reference 不重新从回答正文猜实体。Host 读取同一 Conversation 最新一条先前 Retrieval Trace 的 `resolved/missing/ambiguous`，并用当前 Catalog 重新授权；只有恰好一个仍授权的 resolved entity 且 missing/ambiguous 均为空时才作为 contextual mention，零个时标记 `contextual_reference_missing`，多个实体或 resolved 与 missing/ambiguous 并存时标记 `contextual_reference_ambiguous`。后一类在没有其他显式 resolved entity 时跳过检索，有其他显式 resolved entity 时 coverage 最多 partial；Planner contextual mention 只作诊断 seed，不能覆盖 Host focus。

Entity Resolution result 随请求传递，不写回 Catalog。`stopBeforeRetrieval=true` 时，两个 consumer 记录 Host route audit 后直接进入确定性的 RAG 证据不足回答，不调用 Router；因此模型不能把 entity missing/ambiguous 改写为 `refused` 或 Deep。其他请求的 Deep fallback 也只接受这里唯一 resolved 的 Repository ID。

### 7.3 Route SQL

- exact：规范化正文/标题/实体字段的 phrase equality、substring 和 stable alias；
- lexical：`plainto_tsquery`/`to_tsquery` 的安全 lexeme，加 `pg_trgm` similarity/ILIKE probe；
- vector：把最多两个 semantic query 分别 Embedding，join 当前 active source/index，按 `<=>` cosine distance 排序；
- structured：Knowledge title/summary/type、Material/Repository metadata 和 `knowledge_sources` 关系，只作为 anchor rank。

每路先应用 owner、allowed visibility、status、active revision、active index、revoked 和 Entity Scope 条件。Scope 为 null 时表示问题没有 strict identity；Scope 非空时 Material source 必须属于 `materialIds`，Repository Markdown/PDF/Wiki 必须属于 `repositoryIds`。四 Route 共用同一 `eligible` CTE 参数，任何 Route 或 Provider 都不能绕过。默认 TopK/weight 为 exact `20/1.5`、lexical `30/1.0`、vector `30/1.0`、structured `20/1.2`。RRF 默认 `k=60`，按 stable Child 合并；同 Parent 默认最多三个 Child，同 evidence family 不重复增信。

### 7.4 Rerank、补检与 Answerability

Rerank adapter 按独立 Base URL 和 `provider protocol` 调用 `qwen3-rerank`：`dashscope-compatible` 使用 Workspace 专属 `compatible-api/v1/reranks`、顶层 `results` 与固定问答检索 `instruct`，`cohere-compatible` 使用 `/reranks` 且不发送 DashScope 专属字段。请求包含 query、candidate contextual text 和 `top_n`。Host 只接受输入 index 范围内的唯一结果和 `0..1` finite score；score 仅在当前请求内使用。

Rerank 未配置、超时或失败时使用 RRF，Trace 标记 degradation，Provisional Judge 提高 full 阈值。Provisional Judge 只根据 entity consistency、词/方面 coverage、route/rerank 和 source quality判断是否需要一次补检；它不再扫描任意否定词产生 `conflicted`。只有 round 1 partial/none 才构造 unsupported-aspect retry plan，且 retry 复用完全相同的 Entity Scope；round 2 无论结果如何都停止。

最后一轮后，`assessRagAnswerability` 使用现有 Verifier Chat Profile 完成一次结构化调用，输入仅包含问题、Host `answerAspects`、安全的 Entity Resolution 摘要和最终 Evidence Pack。输出：

```text
aspects[] = {
  aspectId,
  status: supported | unsupported | conflicted,
  evidenceIds[]
}
```

Host 校验所有 aspect/evidence ID 属于当前输入。`conflicted` 至少需要同一 aspect 的两个不同 evidence family；否则降为 supported/unsupported。所有 aspect unsupported 时为 none；部分 supported 为 partial；全部 supported 为 full；任一合法 conflicted 为 conflicted。Gate 只把它引用的 Evidence 交给 Answer Generator，减少“相关但不可回答”的上下文污染。Gate 超时、schema invalid 或引用越界返回 `AI_ANSWERABILITY_FAILED`，message outcome 为 failed，绝不伪装成 none。

## 8. Evidence Pack、Claim 与 Citation

Evidence Pack Builder 先按 Rerank/Parent/family 选择，再计算 token。配置的 `200,000` 是 hard ceiling；effective ceiling 必须扣除 system、conversation、output reserve 和 safety margin。Builder 以 provisional full coverage 提前停止，不为了填满预算加入弱 Evidence；Final Answerability Gate 再把 Pack 收窄为直接支持当前 aspects 的 Evidence。

Answer Generator 输出：

```text
coverage
claims[] = { claimId, aspectId, text, evidenceIds[] }
unsupportedAspectIds[]
```

Orchestrator 在请求开始时从 Host 时钟冻结一次 `currentDate: YYYY-MM-DD`，与 `answerAspects`、resolved/missing entity 摘要一起作为受信任 system context 传给 Answer Generator。Prompt 明确禁止把 Evidence 中的 canonical entity 重命名为另一个 query entity；Generator 不读取 Catalog 全量或未授权实体。`currentDate` 只允许参与工作年限等相对时间计算，不能替代职业 Evidence；同一请求的检索、生成、验证和持久化不得重新取时钟而产生跨日漂移。对于明确询问工作年限的单方面问题，Host renderer 从已通过 Verifier 的 Claim 提取带“起 / since / from”语义的职业起点，并以 `currentDate` 计算约年数或年月；无法得到已验证起点时仍使用普通已验证 Claim，不从原始 Evidence 猜测日期。该派生文本复用 Claim 的 Citation，既覆盖 Provider 遗漏时长，也覆盖 Provider 使用旧年份的情况。

Host 在 Verifier 前重新加载 evidence IDs 并核对 owner、active source/index、visibility、checksum。Claim Verifier 每次只接收一个或一小组 Claim 及其 cited subset，输出 entailed/partial/unsupported/contradicted 和可选 narrowed text。一次 repair 只能删除或收窄 Claim，不能新增 evidence ID。

Citation Validator 确认每条最终 Claim 至少一个 entailed Evidence；Material 使用 Child range/checksum，Repository Markdown 使用 commit/path/lines/checksum，PDF 使用 commit/path/page/checksum，Wiki marker 必须映射当前 Approved Projection 的 Host-verified source。Host 拒绝未知 `aspectId`，在 Verifier 后重新汇总每个 answer aspect，并把没有有效 Claim 的方面转为显式缺口。最终 Claim 先执行规范化完全重复与同方面高重叠检查；同方面安全可判定的重复只保留信息完整的一条，无法安全合并的高重叠返回稳定质量错误。跨方面只拒绝规范化后完全相同的 Claim，允许职责与成果等方面保留必要的公司或项目上下文。Host 按 answer aspect 原顺序和用户语言渲染 Markdown 与 Citation DTO，模型不能直接决定章节顺序或内部 URL。

互相冲突的 Evidence 由 Final Answerability Gate 绑定到具体 aspect 和不同 evidence family 后标记 `conflicted`；Answer 只能说明冲突和各自来源，不能选择“看起来更新”的一方。`partial` 只渲染已支持方面并列出缺口，missing entity 使用用户已经提供的名称生成安全缺口，不列举 Catalog 其他实体。Answerability/Answer/Verifier/Validator failure 使用独立 stable error，不返回 insufficient fallback。

## 9. Provider 与配置

`RuntimeConfig` 新增独立配置：

- `embedding`: API key/base URL/model/dimensions/timeout/retry/batch/concurrency；
- `rerank`: API key/base URL/model/provider protocol/timeout/retry/topN；
- `planner` 与 `verifier`: Chat Profile；
- `retrieval`: route TopK、weights、RRF k、Parent/Child limit、round limit；
- `evidence`: max tokens `200000`、output reserve、safety margin；
- `chunking`: child/parent targets、hard max、min、overlap；
- `repositoryDocuments`: include/exclude、Markdown/PDF/revision limits。

环境 allowlist 包含用户已配置的 `ASKME_EMBEDDING_MODEL_API_KEY`、`ASKME_EMBEDDING_MODEL_API_BASE_URL`、`ASKME_EMBEDDING_MODEL`，默认 dimensions 为 1024。Rerank 使用 `ASKME_RERANK_MODEL_API_KEY`、`ASKME_RERANK_MODEL_API_BASE_URL`、`ASKME_RERANK_MODEL=qwen3-rerank` 和 `ASKME_RERANK_PROVIDER_PROTOCOL`，不从 Embedding Secret 静默派生；部署者可以显式把二者设置为相同 key。

Embedding/Rerank adapter 使用最小 fetch HTTP contract，不强行把非 Chat endpoint 塞进现有 `openai` Chat adapter。Provider 原始错误正文不进入数据库/UI；只记录 request id（若安全）、latency、token/数量和 stable code。

## 10. 权限、强撤销与安全

检索 SQL 必须从当前业务 owner join：Material 要求 `status=indexed` 和 allowed visibility；Repository 文档要求 Repository 未 disabled、active revision 精确匹配且 visibility allowed；Wiki 要求 active approved projection。授权 join 后再应用 Entity Scope，scope 只能减少 eligible rows。`rag_source_versions.visibility` 只用于审计，不作为授权事实源。

Repository 设置以整个 Repository 为唯一发布 owner。visibility 从 private 提升后全部白名单文档可用；后续新增/修改自动继承。降低 visibility、删除、publication revoke 或账号停用时，事务先更新业务状态并使相关 source versions revoked，再返回成功；Embedding row 的物理删除异步执行。

历史消息读取先验证其 Evidence 仍授权。Repository 权限降低时，引用该 Repository 且超出新可见性范围的回答在同一事务中持久标记失效；失效 Citation 投影为 revoked，后续恢复 visibility 或重建 source 不清除该标记。回答依赖失效 Evidence 时状态投影 `evidence_revoked`，只能由新问题生成新回答。不复制私有正文到消息或 Trace，避免撤销后仍可从 snapshot 读取。

Prompt Injection 防护使用结构化消息边界、固定 system contract、Evidence delimiter 和工具为空的 Chat calls。材料中的“指令”不经过任何动态注册路径。Planner 不读取 Evidence，Rerank 无工具，Generator/Verifier 只接收 Host 选择的正文；所有输出经过 schema 与 allowlist 校验。

## 11. Retrieval Trace、状态与反馈

每个 query 建立 trace id，并在相同 owner 下追加 stage metadata。安全投影包含 policy/index/commit、Planner terms/entity mentions、resolved/missing/ambiguous canonical name、scope source count、gate reason、route counts、selected evidence ids/title/score、provisional/final coverage、round、budget、degradation、filter/warning 和 stage latency。Trace 不保存 Catalog 全量、未授权 entity/source IDs 或 Evidence 正文。Candidate 可以展开自己的 trace；Admin 默认只看聚合/安全 metadata，只有通过既有治理授权进入 tenant 诊断时才看相同安全投影。

Repository 页面把 sync 与 index 分栏：sync state、requested/full SHA、artifact ready；index state、active commit、files indexed/skipped、warning/error、last activated。Material 页面同样区分 extracted/indexing/ready/failed。

Feedback API 只写 `rag_feedback`，不调用 Provider、不更新 policy、不创建 Knowledge Item。离线 eval runner 可以导出匿名 case 候选，但真实用户问题和材料默认不进入仓库 fixture。

## 12. 失败、恢复与观测

| 失败 | 行为 | 恢复 |
| --- | --- | --- |
| Embedding 未配置/失败 | Query 降级 lexical；新 source index failed 或 retry | 配置恢复后重跑 source/index version |
| Rerank 未配置/失败 | RRF + strict Judge | 下次请求自动重试 Provider |
| Planner invalid | deterministic plan | 不持久失败状态 |
| Entity missing/ambiguous | 跳过 Embedding/Retrieval，返回安全 none/partial 缺口 | 补充或授权来源、消除 alias 歧义后新问题重试 |
| Answerability invalid | message failed，不伪装 none | Provider 恢复后新问题重试 |
| Answer/Verifier invalid | message failed，不伪装 none | 用户安全重试，新 trace |
| Citation invalid/revoked | 不提交最终回答 | 重新检索；不能复用旧 Evidence |
| Repository file unsupported | ready_with_warnings + skip reason | 调整 glob/limit 或后续 OCR 版本 |
| Worker crash | lease expiry 后幂等恢复 | 旧 active 继续服务 |
| 新 global index failed | 保持旧 active index | 修复后新 version 重建 |

指标至少包含 source indexing latency/count/failure、Embedding batch latency/tokens/errors、entity resolved/missing/ambiguous distribution、preflight retrieval-skip count、scope source count、route hit count/latency、exact vector P50/P95、Rerank/Answerability latency/errors、provisional/final coverage distribution、false-none eval、Citation failure、revocation filter 和 actual evidence tokens。日志只使用 id、state、count、duration、stable code，不打印 question、正文、vector、Prompt 或 Secret。

HNSW gate 由 active vector count 和 exact query P95 触发离线评估；实现不自动建 HNSW。达到 `100,000` 或 P95 `>100 ms` 后，只有 Recall@30 不低于 exact 门禁时才能通过新 migration/policy 启用。

## 13. Entity-grounded RAG 迁移与直接切换

1. Migration 为 `knowledge_items` 增加 `entities jsonb NOT NULL DEFAULT '[]'` 并更新 Drizzle/schema manifest；不建立旧/新双读。
2. Query/Trace 结构直接切换到 typed entity mentions、resolution 和 answerability；旧 `retrieval_policy_version` 不作为兼容路径。
3. `context_prefix_version` 从 `source-context-v1` 提升到 `source-entity-context-v2`，确保 `startIndexRebuild` 创建独立 building index，不复用当前 active vectors。
4. 通过 `rebuild-knowledge-rag --execute --activate` 重新组织全部现有 Materials，生成 evidence-bound entities，并重建 Material/Wiki/Repository 派生索引；旧 Knowledge Item 与旧 index 是可替换派生数据。
5. 新 index 完整、实体回归和索引 smoke 通过后原子激活；当前项目未上线，不保留旧 Query/Entity Policy、feature flag 或兼容 fallback。
6. 应用失败可以重新运行维护入口；数据库 migration 不删除账号、原始 Material/Artifact、Repository、权限、Publication 或会话。已 superseded index 只用于诊断/受控清理，不参与查询。

本地真实部署必须记录前后 users/materials/repositories/publications/conversations/messages 数量并保持不变；Knowledge Item、legacy chunks、rag source/parent/child/vector 数量必须按重建结果诚实变化和对账。

## 14. Golden Dataset 与验证

仓库 fixture 使用至少三名虚构 Candidate，材料、Entity Catalog 与 Evidence ID 稳定。既有 120 case 加至少 12 个 entity-grounding case，以 JSON/JSONL 保存 question、conversation turns、caller、expected entity resolution/scope、coverage/outcome、required/forbidden evidence IDs、可支持目标 Claim 的 acceptable Citation IDs 和 tags；`requiredEvidenceIds` 只约束必须召回的 canonical evidence，不能误作唯一合法 Citation。Eval runner 分两层：

1. 离线层调用生产 `DeterministicQueryAnalyzer`、纯函数 `resolveEntityMentions`、RRF、Evidence Pack/Coverage 与 permission filter；route fixture/stub 只模拟数据库候选，不用 tag/关键词直接生成 outcome；
2. `eval-rag-runtime.ts` 在隔离真实 PostgreSQL fixture 上创建至少两个相似项目和不同 visibility，调用真实 Planner、Embedding、四 Route SQL、Rerank、Final Answerability、Answer、Claim Verifier 与 Citation Validator，运行至少 12 个 known/unknown/alias/multi-entity/context/permission case；结束删除 fixture owner 与 artifact。

Provider 非确定输出不以逐字答案为 gold；gold 只约束 outcome、Claim key facts 和 Evidence IDs。Prompt Injection、conflict、duplicate family、Repository commit 切换、强撤销和所有降级模式必须有 case。

自动化门禁包括 unit、PostgreSQL integration、migration-from-current-data、provider contract、worker lease、security、API 和 full build。真实验收使用当前本地 Candidate/Public Agent：Candidate Preview 验证私有授权 Askme/职业资料，Public Chat 验证 OneCat 正常回答、未知 Askme 在检索前拒答、OneCat + 未知实体只形成安全 partial/none、Citation/Trace/会话持久化以及无 Console/Network 错误。

## 15. 隔离源码分析保留边界

现有 `src/server/code-agent`、`analysis_runs`、BoxLite microVM、Pi guest 只读工具、SSE 和 Host Citation 校验继续服务 `deep`。本修订只改变 Repository 选择前提：Host Entity Gate 允许继续后，Router 才能在文档 RAG 后提出 deep 建议；确定性源码检查语法只负责产生 explicit Repository mention，最终仍必须由 Entity Resolver 唯一解析到同一个授权 Repository 后才能排队。最终 Citation 继续进入统一授权投影，Trace 记录 route transition。

Deep run 仍绑定一个 owner、Repository、完整 SHA 和 artifact checksum；每 run 新 microVM，不挂载 Host 工作树，不持有 GitHub Token，不执行 Shell/build/test/install/network。中间 reasoning/tool output 不持久化，cleanup 成功后才提交最终回答；失败不回退成伪成功 RAG。

## 16. 外部选型依据

- pgvector 官方支持 PostgreSQL 内 exact/approximate nearest-neighbor、cosine distance、filter、FTS + RRF/cross-encoder 混合检索；当前实现初始只用 exact。
- 阿里云百炼官方说明 `qwen3.7-text-embedding` 支持 256–2560 自定义维度和多语言长文本，当前实现固定 1024 维避免同索引混维度。
- 阿里云百炼官方 `qwen3-rerank` 接口返回输入 document index 与请求内 `relevance_score`，因此 adapter 只用它排序当前候选，不把分数当跨请求阈值。
