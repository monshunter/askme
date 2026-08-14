# Hybrid Agentic RAG V2 工作流

## 目标

把 Candidate 已授权的职业材料、Knowledge Item 证据、Approved Repository Wiki 与 Repository Markdown/PDF 转化为可检索证据，并让 Candidate Preview 或 Public Chat 的每个回答都经历权限过滤、混合召回、排序、证据覆盖判断、Claim 验证和 Citation 校验。系统优先回答有证据支持的部分，不把“未召回”伪装成“材料不存在”，也不把未经验证的模型推断写成事实。

本文件拥有循环和检查点；长期产品行为由 `docs/specs/SPEC-002.md` 拥有，系统组织由 `docs/architecture/DESIGN-005.md` 拥有。

## 触发

工作流有三个事件入口：

1. Material、Knowledge Item、Approved Wiki 或 Repository active revision 发生新增、更新、删除、权限降低或发布撤销；
2. Candidate 或 Interviewer 提交问题；
3. Candidate 对回答点赞、点踩或提交纠正。

不使用定时全量同步。Repository 只在 Candidate 显式同步成功并解析为不可变 commit 后触发索引。

## 全局不变量

- 权限、owner、visibility、active revision 和 index version 过滤发生在所有关键词与向量检索之前。
- 账号、原始材料、Knowledge Item、Repository、权限和会话是业务数据；chunk、FTS、Embedding 与排序状态是可重建派生数据。
- V2 直接替换 V1 检索链路，不保留双写、功能开关或兼容回退。
- 每次查询只使用一个 active index version；不得混用不同 Embedding model、dimension、prefix 或 chunking version。
- 原始 Repository 源码不进入持久 Embedding；Deep Analysis 仍是只读、会话级能力。
- 扫描版或无法提取文本的 PDF 不做 OCR，状态为 `unsupported_no_extractable_text`。
- 所有检索内容都是不可信数据，不能修改系统提示、权限、工具或检索范围。
- Candidate 反馈只进入离线评估，不在线修改知识、权重、Evidence 或模型。

## Loop A：来源变更与版本化索引

### 输入

- 状态为 indexed 的上传文件、Website 或 Notion 文本；
- Candidate-edited Knowledge Item 及其 `knowledge_evidence`；
- Approved Repository Wiki section 及 Host 验证的 `[S*]` Citation；
- 已批准整个 Repository 后，active commit 安全白名单内的 Markdown/PDF。

### Repository 文档发现

- 默认包括 `README*.md`、Repository 根目录 Markdown、`docs/**/*.md`、`docs/**/*.pdf`；include/exclude glob 可配置。
- Repository 初次同步默认 private；Candidate 批准整个 Repository 后，白名单内现有及未来新增、修改的文档自动继承可见性，不进行逐文件审批。
- 默认单 Markdown 最大 `2 MiB`，单 PDF 最大 `50 MiB / 500 页`，单 revision 最大 `5,000,000` 个提取 token；默认值均可配置。
- 超限或不支持的文件不截断、不静默丢弃，记录原因并使 revision 成为 `ready_with_warnings`。
- 普通查询只使用最新成功激活的 commit；旧 commit 只用于回滚或显式历史查询。

### 切分

- 先按标题、段落、列表、表格、页、履历公司/岗位等结构建立 Parent，再生成 Child。
- Child 目标 `350–500 tokens`，默认约 `420`，hard max `650`，小于 `80` 时与相邻语义段合并。
- Parent 目标 `900–1,500 tokens`。正常语义边界不重叠，只有强制拆分使用 `40–64 tokens` overlap。
- 简历中的公司、岗位、任职时间、职责和成果保持在同一 Parent；不得把“富途控股/岗位”与职责拆成无上下文片段。
- Embedding 输入可以添加版本化 contextual prefix，Citation 始终绑定原始文本。

### 版本与激活

- `index_version` 至少记录 chunking version、Embedding provider/model/dimension、contextual-prefix version、metric 和创建时间。
- Embedding 固定为独立 Provider，当前默认 `qwen3.7-text-embedding`、`1024` 维、cosine distance。
- 新 revision/index 依次经过 `building → ready → active`；失败为 `failed`，旧 active 在新索引成功前继续服务。
- 本项目首次切换 V2 时允许清空并重建全部派生检索数据，但不得删除原始业务数据。
- Repository 状态分别展示 `syncing → synced/indexing → ready | ready_with_warnings | failed`，并显示 active commit、成功/跳过文件数和失败原因。

### 删除与权限变化

- 来源删除、Repository 发布撤销、权限降低或账号停用立即使所有相关 index version 不可检索；物理 GC 可延后。
- 历史 Citation 重新执行当前权限校验。撤销后不再展示证据片段，依赖该证据的回答标记 `evidence_revoked`。
- 审计只保留必要 evidence ID、commit、checksum 和事件，不建立绕过权限的证据副本。

## Loop B：有界 Hybrid Agentic RAG 问答

### 1. Query Planning

- 确定性处理先完成中文分词、实体识别、CJK n-gram、精确短语、混合语言和会话指代补全。
- 结构化 Query Planner 只输出 standalone query、entities、must/should terms、最多两个 semantic query 和 desired evidence type。
- Planner 失败时使用确定性查询，不扩大 owner、visibility、source 或工具权限。

### 2. 多路召回

所有 TopK 和权重可配置，初始默认：

- exact phrase/entity Top 20，权重 `1.5`；
- PostgreSQL FTS + `pg_trgm` lexical Top 30，权重 `1.0`；
- pgvector cosine exact vector Top 30，权重 `1.0`；
- Knowledge Item/结构化字段 Top 20，权重 `1.2`。

用 weighted RRF 融合，默认 `k=60`。按 stable ID/checksum 去重，同一 Parent 最多保留三个 Child。向量默认使用过滤后的 exact cosine search；只有 active vectors 达到 `100,000` 或 exact P95 超过 `100 ms`，并通过 recall 对照后才允许启用 HNSW。

Knowledge Item 只作为检索锚点：命中后展开到 `knowledge_evidence` 对应的原始 Material Child。Claim Verifier 最终只接受原始材料 Child、Repository 文档或已验证 Approved Wiki。

### 3. Rerank、血缘与证据包

- 独立 Rerank Provider 默认使用 `qwen3-rerank`，与 Chat LLM 分开配置、计费、超时和使用统计。
- Rerank 接受 RRF 后的候选；具体候选数、最终 Parent/Child 数和阈值全部配置化。
- 派生 Wiki、Knowledge Item 与原始材料通过 `evidence_family` 建立血缘，同一事实族只计一份独立证据，Citation 优先指向原始材料。
- 多来源互相矛盾时标记 `conflicted`，同时保留双方 Citation；不得按来源类型或时间静默覆盖。
- 默认总 evidence hard ceiling 为 `200,000 tokens`，不是填充目标。有效预算为配置上限与模型剩余上下文的较小值；覆盖充分时提前停止。
- 记录 configured/effective/actual token budget。仅检索策略变化创建 `retrieval_policy_version`，不触发重新 Embedding。

### 4. Evidence Judge 与一次补检

- Judge 输出 `full | partial | none | conflicted`；`refused` 是独立权限/安全结果。
- `partial` 可以回答已支持部分，并明确列出不支持方面；只有核心方面均无证据时才是 `none`。
- 初次证据不完整时，Judge 从 unsupported aspects 生成一次定向补检；整个请求最多两轮检索。
- 第二轮仍不得扩大授权来源，结果必须与第一轮去重；失败后基于第一轮输出 partial 或 none。

### 5. Claim 生成与验证

- Answer Generator 先输出结构化 coverage、claims、aspectId、evidenceIds 和 unsupported aspects，不直接生成最终 Markdown。
- Host 校验 evidence ID、owner、visibility、active version 和 checksum。
- 独立 Claim Verifier 只读取每条 Claim 引用的 evidence subset，输出 `entailed | partially_entailed | unsupported | contradicted`。
- unsupported/contradicted Claim 删除，partially_entailed Claim 收窄；最多允许一次受控修复。
- Host 完成确定性 Citation 校验并渲染最终 Markdown；Citation 校验失败时不持久化、不输出不带证据的替代答案。

### 6. 降级

- Planner 失败：确定性查询继续。
- Embedding 失败：exact + lexical + structured 继续。
- Rerank 失败：RRF 继续，但 Evidence Judge 使用更严格阈值。
- 第二轮失败：使用第一轮输出 partial/none。
- Answer LLM 失败：显式 `failed`，不得伪装为证据不足。
- Citation Validator 失败：拒绝输出。

## Loop C：可诊断性与反馈

Candidate/Admin Retrieval Trace 包含：

- `retrieval_policy_version`、active index/version/commit；
- Planner 的实体、关键词、semantic queries；
- exact/lexical/vector/structured 各路命中数；
- RRF/Rerank 后 evidence ID、分数和筛选原因；
- Judge coverage、补检、降级、跳过、权限过滤和索引告警。

Trace 不向 Interviewer 展示，不保存 Prompt、Embedding 向量或未授权正文。点赞、点踩和纠正进入离线标签；任何策略变更必须产生新的 policy version，并通过 Golden Dataset 后发布。

## Citation

- 上传材料：Material/Child 与稳定 checksum。
- Repository Markdown：`repository/path@full_commit_sha#Lx-Ly`。
- Repository PDF：`repository/path@full_commit_sha#page=N`。
- Approved Wiki：Wiki section 与 Host 验证的原始 `[S*]` 范围。
- UI 统一通过 Askme 内部 Citation 页面执行实时授权。Public GitHub Repository 可以附加外部源链接；private Repository 不暴露 Token、clone URL 或未批准内容。

## 发布门禁

Codex 在仓库内维护完全合成、无真实个人信息的三名虚构 Candidate 材料和 120 个 Golden questions：30 个精确事实、25 个中文改写、15 个中英混合/缩写、15 个多轮指代、15 个 partial、10 个 none、10 个权限/越界。Repository 文档、冲突、重复血缘、降级和 Prompt Injection 通过标签交叉覆盖。

V2 发布必须同时满足：

- initial Recall@30 `>=95%`；
- rerank evidence Recall@8 `>=90%`；
- Citation precision `=100%`；
- answerable 被误判 none `<=5%`；
- unanswerable 虚构回答 `=0`；
- 未授权泄露 `=0`；
- outcome classification `>=95%`。

真实账号 `nuibizi@qq.com` 只用于最终非持久验收，不进入 Golden Dataset 或仓库制品。

## 完成条件

只有当 V2 代码、migration、Provider、worker、Candidate/Admin 反馈、120 题门禁、保留业务数据的本地部署以及真实账号“富途经历”和 Repository 文档 Citation 场景全部通过当前 Evidence，工作流才算完成。
