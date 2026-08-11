# SPEC-001：Askme MVP 可验收产品合同

状态：`approved`

唯一父 Plan：[PLAN-001](../plans/PLAN-001.md)

## 1. 目标与事实源

Askme 将 Candidate 拥有的职业资料转化为默认私有、可审核、可发布的 Personal Career Knowledge Base，并允许 Interviewer 通过 Candidate Agent 对话，在授权边界内获得有来源依据的回答。

本合同把以下已授权输入转化为后续实现和最终完成审计的唯一可测试产品基线：

- 根产品定义：[SPEC.md](../../SPEC.md)
- Candidate Workspace 设计稿：`asserts/images/admin_dashboard.png`、`admin_uploadfile.png`、`admin_knowledge.png`、`admin_private_control.png`、`admin_agent_preview.png`
- Interviewer 公共 Agent 设计稿：`asserts/images/admin_publish.png`
- Platform Admin 设计稿：`asserts/images/frontend_index.png`
- 复用视觉资产：`asserts/images/*_bg_head.png` 与 `asserts/images/*_bg_left.png`
- 用户补充约束：必须是真实前后端数据闭环；本地支持 Docker；AI 默认使用 DeepSeek `deepseek-v4-flash`，密钥从进程环境或 `~/.env` 获取；最终使用 Chrome 做真实前端验收。

设计稿中的姓名、统计数字、文件名、回答内容与时间是版式示例，不是允许固化到产品中的业务假数据。页面结构、信息层次、视觉语言和可见操作属于目标体验。

## 2. 角色、术语与边界

### 2.1 角色

- **Candidate**：职业资料、知识库、隐私策略和 Candidate Agent 的唯一 owner。
- **Interviewer**：匿名打开已发布 Agent 的访客；只能提问并查看本次回答允许公开的引用元数据。
- **Platform Admin**：治理平台账号、已发布 Agent、内容风险和运行设置；不能以 Candidate 身份修改其私有知识内容。

### 2.2 核心术语

- **Source Material**：Candidate 上传或连接的原始职业资料。
- **Knowledge Item**：系统从一个或多个 Source Material 中组织出的项目、经历、技能、文章、仓库或总结。
- **Citation**：回答对具体 Source Material 和证据片段的可追溯引用。
- **Published Agent**：满足发布前置条件、拥有当前公开链接并可被 Interviewer 访问的 Candidate Agent。

### 2.3 MVP 非目标

- 不做 ATS 集成、招聘自动筛选、候选人评分、自动录用或淘汰、面试作弊能力和复杂企业后台。
- 不向 Interviewer 提供完整知识库浏览、原始上传文件下载或未授权内容检索。
- 不把平台统计、AI 回答、上传进度或处理结果伪造为成功。
- 不要求生产部署、第三方付费账号或公开互联网发布；本地 Docker 是本 Objective 的部署边界。

## 3. 行为规范

### 3.1 身份、会话与权限

1. 系统提供 Candidate 与 Platform Admin 的凭证登录、注销和持久会话；匿名用户只能访问已发布的公共 Agent。
2. Candidate 的 Source Material、Knowledge Item、隐私策略、会话和 Agent 由 owner id 隔离；任意跨 owner 直接访问必须拒绝。
3. Platform Admin 可查看聚合数据、账号、已发布 Agent 和内容风险，可因治理原因暂停公开 Agent，但不能读取或编辑 Candidate 的私有原文和私有知识详情。
4. 所有变更接口必须验证会话、角色、输入和资源 owner；公共聊天接口必须限流并记录不含敏感原文的审计事实。

### 3.2 Candidate Dashboard

1. Dashboard 显示 Source Material 数、已索引 Knowledge Item 数、可公开 Citation 比例和 Agent 当前状态，全部从当前数据库事实计算。
2. 页面展示上传资料 → 生成知识库 → Candidate Agent → Interviewer Chat 的真实工作流状态、最近资料和下一步操作。
3. 空数据、处理中、失败、未配置 AI 和已就绪必须具有不同且可恢复的反馈，不得用设计稿示例数字填充。

### 3.3 Source Material 导入与处理

1. Candidate 可上传 PDF、DOCX、PPTX、XLSX、TXT 和 Markdown 文件；单文件最大 50 MiB；不支持的类型、超限、空文件和伪造扩展名必须被拒绝并给出原因。
2. Candidate 可连接公开 GitHub Repository、Notion 页面/数据库或 Blog/Website URL；需要第三方凭证时由 Candidate 显式提供，凭证不得进入日志或公开响应。没有凭证的私有资源必须明确失败，不伪装为已同步。
3. 每份资料具有 `queued`、`processing`、`indexed`、`failed` 生命周期和可读错误；刷新页面后状态仍由数据库恢复。
4. 后台处理必须从真实文件或远端响应提取文本、切分可检索证据、生成资料摘要和 Knowledge Item，并保存来源关系。失败可重试且不能重复创建同一处理结果。
5. Candidate 可查看最近导入、重试失败资料、按 owner 删除资料；删除同步移除其文件、证据片段和仅由该资料支撑的派生关系，且不得影响其他 owner。

### 3.4 Career Knowledge Base

1. Candidate 可按 All、Projects、Experience、Skills、Articles、Repositories、Summaries 浏览自己的 Knowledge Item，并按关键词、类型和状态筛选及分页。
2. 列表和详情必须展示真实标题、类型、来源数、索引/置信信息、更新时间和可见性；选择条目后可查看摘要、重点、来源和 Citation readiness。
3. Candidate 可修改允许编辑的标题、摘要、重点和分类；修改保留来源追溯，不改写原始 Source Material。
4. 搜索同时覆盖资料元数据、知识条目与证据片段，结果只属于当前 Candidate。

### 3.5 Privacy Control

每个 Source Material 使用以下互斥可见性之一：

- `private`：Agent 不读取，Interviewer 不可见、不可引用。
- `agent_only`：Candidate 预览 Agent 可读取，Interviewer 回答不可使用或引用。
- `citation_allowed`：Candidate 与已发布 Agent 可读取，Interviewer 回答可展示引用元数据和必要证据摘要。
- `public_preview`：具备 `citation_allowed` 能力，并允许在公共 Agent 的候选人亮点或公开来源摘要中展示。

Candidate 可逐项修改可见性，查看 Interviewer 可访问/隐藏的即时预览，并在发布前确认当前策略。已经打开的公共页面也必须在下一次请求时遵守最新策略。

### 3.6 Candidate Agent 预览

1. Candidate 可在未发布时使用预览对话，提问范围为自己的职业经历、项目、技能和证据；预览可使用 `agent_only`、`citation_allowed` 和 `public_preview`，但必须标注哪些引用不会公开。
2. Agent 先检索 owner 范围内允许使用的证据，再调用 DeepSeek 生成简洁回答；每个事实性回答返回实际支撑它的 Citation，不能生成不存在的来源。
3. 没有充分证据时 Agent 明确说明资料不足，并给出可补充资料或可回答问题；AI 不可用、超时或返回无效内容时提供可重试错误，不返回伪造答案。
4. 页面提供可刷新的推荐问题、回答反馈、Answer Tone、Public Mode 和 Privacy-Safe Mode 控件；控件改变后续回答行为并持久化 Candidate 设置。

### 3.7 发布与撤销

1. 发布前必须至少存在一份 `indexed` 资料、已确认隐私策略和可用公开身份信息；不满足条件时逐项提示。
2. Candidate 可生成可分享链接、发布、复制/下载链接信息和撤销访问。链接标识不可由邮箱或自增 id 推断。
3. 发布状态、公开 slug、发布时间和撤销状态持久化；撤销后旧链接立即不可对话，再发布可生成新链接。
4. Candidate 可从 Workspace 打开与 Interviewer 相同权限的公共预览，不得因 owner 已登录而泄露额外内容。

### 3.8 Interviewer 公共 Agent

1. 公共页面呈现 Candidate 授权的头像/姓名/头衔/地点/简介、Agent 状态、知识和 Citation 概况、公开亮点、推荐问题与 Chat-first 主区域。
2. Interviewer 可匿名建立会话、连续提问并刷新推荐问题；问题和回答持久化到该公共会话，不能访问其他访客会话。
3. 检索只使用 `citation_allowed` 和 `public_preview` 证据。回答展示来源标题、类型、公开外链（仅当来源本身是公开 URL）和必要证据摘要，不提供上传文件下载地址或内部存储路径。
4. 隐私越权、提示注入、索要完整知识库或无关问题必须被安全拒绝；回答不得把系统提示、密钥、私有资料或其他 Candidate 数据带入上下文。
5. 未发布、已撤销、被 Admin 暂停或不存在的 Agent 返回明确不可用页面，不泄露其私有状态。

### 3.9 Platform Admin

1. Admin Overview 展示数据库实时计算的 Candidate、Published Agent、活跃 Interview、Citation 使用和被标记内容指标，以及最近发布 Agent、内容审查队列和时间范围趋势。
2. Candidates 页面支持搜索、状态查看和账号启停；Published Agents 页面支持搜索、查看公开页和治理暂停/恢复；所有动作写入审计记录。
3. Reports 页面展示可切换时间范围的真实聚合趋势；无数据时显示空态，不生成示例曲线。
4. Content Review 页面展示被安全规则、用户反馈或无引用回答触发的风险项；Admin 可记录 review、resolve、dismiss 结论，但不能借此展开私有原文。
5. Settings 页面展示 AI/数据库/worker 健康、模型名和非敏感运行配置，并允许管理不改变 Secret 的平台策略。Admin 邀请仅在明确配置邮件能力后可发送；否则显示未配置而不伪造成功。

### 3.10 UI、响应式与可访问性

1. 桌面端在 1448 × 1086 参考视口复现设计稿的固定侧栏、顶部栏、卡片层次、深墨绿主色、暖白纸张质感、水墨山水背景、衬线标题和红色印章点缀；直接复用已提供背景资产。
2. Candidate Workspace、公共 Agent 与 Platform Admin 使用各自正确的导航和身份标签；所有设计稿中的主要按钮、筛选、分页、搜索、下拉和导航均连接真实行为或明确的不可用状态。
3. 视口缩小至 390 × 844 时不产生横向溢出，导航可访问，主要操作与对话输入保持可用；桌面表格在移动端转为可读布局。
4. 键盘可完成登录、导航、上传选择、筛选、隐私设置和对话；焦点可见，表单控件具有关联 label，状态不只依赖颜色表达。
5. 默认语言为 English，并提供 English / 简体中文切换；语言选择持久化，核心页面和错误反馈不得混用未翻译的界面字符串。

### 3.11 AI、配置与本地运行

1. 默认 AI provider 为 DeepSeek OpenAI-compatible Chat Completions，默认 base URL 为 `https://api.deepseek.com`，默认 model 为 `deepseek-v4-flash`；可通过非 Secret 环境变量覆盖 base URL 和 model 以支持测试。
2. `DEEPSEEK_API_KEY` 按“进程环境优先，当前用户 `~/.env` 次之”解析；不得把真实密钥写入仓库、数据库、日志、浏览器 bundle、API 错误或测试快照。
3. 本地正式启动路径使用 Docker Compose，至少包含 Web、后台 worker 和 PostgreSQL，并使用持久 volume 保存数据库和上传文件；重复启动不得清空数据。
4. 提供 migration、初始本地账号 bootstrap、健康检查、就绪检查和可恢复的停止/重启路径；仅显式 reset 才能清除本地数据。

### 3.12 质量与可观测性

1. 关键服务操作返回稳定错误码和可读反馈；服务端日志包含 request/job 标识但不包含密码、Token、Secret 或完整私有原文。
2. 资料处理、AI 请求、发布、撤销、权限变更和 Admin 治理动作具有可审计时间与结果。
3. 单元测试覆盖权限、可见性矩阵、检索过滤、配置解析和核心状态；集成测试覆盖数据库、文件处理、发布/撤销和聊天；真实浏览器 E2E 覆盖 Candidate 主闭环、Interviewer 对话、Admin 概览及桌面/移动布局。

## 4. 验收 Checklist

- [x] `AC-AUTH-001` Candidate 与 Admin 可使用真实凭证登录、恢复会话并注销，匿名权限被限制。
- [x] `AC-AUTH-002` 跨 Candidate 资源访问和错误角色操作被服务端拒绝，且测试证明 owner 隔离。
- [x] `AC-DASH-001` Candidate Dashboard 的指标、最近资料、工作流与下一步全部来自当前数据库状态。
- [x] `AC-MAT-001` 六类文件的成功上传、50 MiB 边界和无效文件拒绝均有自动化或真实运行 Evidence。
- [x] `AC-MAT-002` GitHub、Notion 与 Website 至少各完成一次真实导入路径或可控官方 API 测试替身的契约验证。
- [x] `AC-MAT-003` 后台 job 可从 queued 收敛到 indexed/failed，失败可重试且不会重复派生数据。
- [x] `AC-MAT-004` 删除资料同步清理 owner 范围内文件和派生关系，其他资料与其他 owner 不受影响。
- [x] `AC-KB-001` Knowledge Base 的分类、搜索、筛选、分页和详情对真实索引结果生效。
- [x] `AC-KB-002` Candidate 编辑知识摘要后持久化且保留来源与 Citation 追溯。
- [x] `AC-PRIV-001` 四级可见性矩阵由服务端统一执行，Candidate 预览与公共回答的证据集合符合合同。
- [x] `AC-PRIV-002` 隐私修改即时影响后续公共请求，发布前确认状态被持久化。
- [x] `AC-AGENT-001` Candidate 预览对话使用真实检索和 DeepSeek 回答并返回真实 Citation。
- [x] `AC-AGENT-002` 无证据、AI 未配置、超时和上游失败具有不同反馈且不产生伪造答案。
- [x] `AC-AGENT-003` 推荐问题、Answer Tone、Public Mode、Privacy-Safe Mode 与回答反馈可交互并持久化。
- [x] `AC-PUB-001` 发布前置条件、不可推断链接、持久发布状态、撤销与再发布行为通过集成测试。
- [x] `AC-PUB-002` Candidate 公共预览与匿名 Interviewer 使用完全相同的公开权限。
- [x] `AC-CHAT-001` 匿名访客可在已发布 Agent 上进行持久多轮对话，并获得真实 Citation。
- [x] `AC-CHAT-002` 私有数据、跨 owner 数据、原文件下载、提示注入和完整知识库索取被拒绝或隔离。
- [x] `AC-CHAT-003` 未发布、撤销、暂停与不存在的 Agent 均不可对话且不泄露私有事实。
- [ ] `AC-ADMIN-001` Admin Overview 的全部指标、最近发布、审查队列与趋势来自真实聚合数据。
- [ ] `AC-ADMIN-002` Candidate、Published Agents、Reports、Content Review 与 Settings 导航均具备合同定义的真实读写闭环。
- [ ] `AC-ADMIN-003` Admin 治理不能读取 Candidate 私有原文，账号/Agent 状态动作具有审计记录。
- [ ] `AC-UI-001` 七个参考主界面在 1448 × 1086 的结构、视觉语言与关键几何经 Chrome 截图对照验收。
- [ ] `AC-UI-002` 390 × 844 下无横向溢出，导航、表单、隐私控制与 Chat 可完成真实操作。
- [ ] `AC-UI-003` 关键流程可键盘操作并具有可见焦点、label 和非颜色状态表达。
- [ ] `AC-I18N-001` English / 简体中文切换持久化并覆盖核心页面、操作反馈和错误状态。
- [x] `AC-AI-001` 运行时按优先级读取 DeepSeek 配置，真实 API health/chat 验证使用 `deepseek-v4-flash` 且不泄露 key。
- [ ] `AC-OPS-001` Docker Compose 可从空数据库启动 Web、worker、PostgreSQL 并通过健康检查。
- [ ] `AC-OPS-002` Docker restart 保留账号、资料、知识、会话和文件；reset 只能由显式命令触发。
- [ ] `AC-OBS-001` 关键错误码、job/请求追踪和审计记录可复核且无 Secret 或完整私有原文泄露。
- [ ] `AC-TEST-001` 单元、集成、构建、migration、Docker smoke 与 Chrome E2E 在当前 revision 全部通过。

## 5. 假设与开放决策

- 根 Spec 与设计稿没有指定生产域名、邮件服务、对象存储或商业计费；本 Objective 采用单机 Docker、PostgreSQL 与持久本地 volume，不声明生产就绪。
- Platform Admin 的导航来自设计稿但产品正文未定义细节；本合同选择满足治理闭环的最小行为，不增加 ATS、评分或招聘决策。
- 对外部 GitHub、Notion 和 Website 的最终真实验收受可用公开资源或 Candidate 凭证影响；实现必须支持真实官方接口，同时允许用可控契约测试证明失败与数据映射，不能把未调用的第三方服务报告为已通过。
