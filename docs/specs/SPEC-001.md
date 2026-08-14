# SPEC-001：Askme MVP 可验收产品合同

Boundary ID：`askme-mvp-product`

Owner boundary：Askme MVP 的 Candidate、Interviewer 与 Platform Admin 外部可见行为和验收边界。

Status：`active`

批准状态：`approved`

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
- **Interviewer / Visitor**：匿名打开已发布 Agent 的浏览器级游客；只能提问、查看本次回答允许公开的引用名称，并在来源允许公开访问时打开该来源。
- **Platform Admin**：治理平台账号、已发布 Agent、内容风险和运行设置；不能以 Candidate 身份修改其私有知识内容。

### 2.2 核心术语

- **Source Material**：Candidate 上传或连接的原始职业资料。
- **Knowledge Item**：系统从一个或多个 Source Material 中组织出的项目、经历、技能、文章、仓库或总结。
- **Citation**：回答对具体 Source Material 和证据片段的可追溯引用。
- **Published Agent**：满足发布前置条件、拥有当前公开链接并可被 Interviewer 访问的 Candidate Agent。
- **Browser Visitor Identity**：由当前 origin 的 localStorage 保存的高熵游客凭证；同一浏览器使用同一游客身份访问不同 Published Agent，每个 publication 分别拥有该游客自己的 Conversation 集合。

### 2.3 MVP 非目标

- 不做 ATS 集成、招聘自动筛选、候选人评分、自动录用或淘汰、面试作弊能力和复杂企业后台。
- 不向 Interviewer 提供完整知识库浏览、未公开来源文件访问或未授权内容检索。
- 不把平台统计、AI 回答、上传进度或处理结果伪造为成功。
- 不要求生产部署、第三方付费账号或公开互联网发布；本地 Docker 是本 Objective 的部署边界。

## 3. 行为规范

### 3.1 身份、会话与权限

1. Candidate 可自助注册，并与 Platform Admin 一样使用凭证登录、注销和持久会话；自助注册只能创建 `candidate`，不能创建或提升为 `admin`。
2. Candidate 的 Source Material、Knowledge Item、隐私策略、会话和 Agent 由 owner id 隔离；任意跨 owner 直接访问必须拒绝。
3. Platform Admin 可查看聚合数据、账号、已发布 Agent 和内容风险，可因治理原因暂停公开 Agent，但不能读取或编辑 Candidate 的私有原文和私有知识详情。
4. 所有变更接口必须验证会话、角色、输入和资源 owner；公共聊天接口必须限流并记录不含敏感原文的审计事实。
5. Candidate 忘记密码时可提交邮箱并获得不暴露账号是否存在的统一反馈；只有当前有效 Candidate 才收到短时、单次使用的重置链接。成功重置必须使同一账号全部旧会话失效。
6. 已登录 Candidate 可验证当前密码后设置不同的新密码；成功后撤销全部旧会话并签发当前浏览器的新会话。密码不得进入 URL、日志、审计 metadata 或数据库明文列。
7. 注册、登录、忘记密码、重置和改密均使用相同的邮箱规范化、密码强度、稳定错误与滥用防护；冻结账号不能通过任一认证入口恢复访问。
8. 每个 active Candidate，不论来自自助注册、邀请、bootstrap 或历史数据，都可在账号页编辑自己的公开显示名称、职业头衔、地点和简介；服务端只允许 Candidate 修改当前 owner，校验字段长度并记录不含资料正文的审计事实。职业头衔不由系统猜测或自动生成。

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
6. Candidate 工作区中每个 Source Material 文件名都可打开 owner 范围内的真实来源；Markdown、PDF 在当前页居中预览，PDF 默认使用 A4 纸张比例，其他格式在新标签页打开。

### 3.4 Career Knowledge Base

1. Candidate 可按 All、Projects、Experience、Skills、Articles、Repositories、Summaries 浏览自己的 Knowledge Item，并按关键词、类型和状态筛选及分页。
2. 列表和详情必须展示真实标题、类型、来源数、索引/置信信息、更新时间和可见性；选择条目后可查看摘要、重点、来源和 Citation readiness。
3. Candidate 可修改允许编辑的标题、摘要、重点和分类；修改保留来源追溯，不改写原始 Source Material。
4. 搜索同时覆盖资料元数据、知识条目与证据片段，结果只属于当前 Candidate。
5. Dashboard、资料列表、Knowledge 来源、Privacy 来源预览和 Candidate Agent Citation 中出现的 Source Material 文件名使用同一查看行为，不能存在只有部分入口可打开的并行语义。

### 3.5 Privacy Control

每个 Source Material 使用以下互斥可见性之一：

- `private`：Agent 不读取，Interviewer 不可见、不可引用。
- `agent_only`：Candidate 预览 Agent 可读取，Interviewer 回答不可使用或引用。
- `citation_allowed`：Candidate 与已发布 Agent 可读取，Interviewer 回答只展示引用来源名称，不提供来源访问地址、正文、摘要或证据片段。
- `public_preview`：具备 `citation_allowed` 能力，并允许在公共 Agent 展示候选人亮点，以及从回答中的来源名称打开原来源。

Candidate 可逐项修改可见性，查看 Interviewer 可访问/隐藏的即时预览，并在发布前确认当前策略。首次未确认时提供确认操作；当前策略修订已经确认时隐藏确认按钮，只有后续来源可见性变更使修订失效后才显示“再次确认”。已经打开的公共页面也必须在下一次请求时遵守最新策略。

### 3.6 Candidate Agent 预览

1. Candidate 可在未发布时使用预览对话，提问范围为自己的职业经历、项目、技能和证据；预览可使用 `agent_only`、`citation_allowed` 和 `public_preview`，但必须标注哪些引用不会公开。
2. Agent 先检索 owner 范围内允许使用的证据，再调用 DeepSeek 生成简洁回答；每个事实性回答返回实际支撑它的 Citation，不能生成不存在的来源；用户问题与 Agent 回答按安全 Markdown 渲染。
3. 没有充分证据时 Agent 明确说明资料不足，并给出可补充资料或可回答问题；AI 不可用、超时或返回无效内容时提供可重试错误，不返回伪造答案。
4. 页面提供可刷新的推荐问题、回答反馈、Answer Tone、Public Mode 和 Privacy-Safe Mode 控件；控件改变后续回答行为并持久化 Candidate 设置。
5. Candidate Workspace 只提供一个英文 `Agent`、中文 `智能体` 的一级入口；该页面同时承载 Candidate 预览问答、设置和发布生命周期管理，不再提供独立的 Publish Agent / 发布 Agent 一级入口或页面。

### 3.7 发布与撤销

1. 发布前必须至少存在一份 `indexed` 资料、已确认隐私策略和由非空显示名称与职业头衔组成的可用公开身份；不满足条件时逐项提示。公开身份阻塞项必须直达可编辑的账号公开资料区，保存成功后回到 Agent 页面并以最新数据重新计算 readiness，不得把用户送到没有修复操作的 Dashboard。
2. Candidate 可在 Agent / 智能体页面直接发布，不需要预先生成或管理分享链接；发布操作原子生成不可由邮箱或自增 id 推断的公开 slug。发布成功后，“访问 Agent”与“撤销访问”并列显示，且访问操作位于撤销操作左侧。
3. 发布状态、公开 slug、发布时间和撤销状态持久化；已有历史 draft 时发布操作继续使用其 slug，撤销后旧链接立即不可对话，再发布生成新链接。
4. Candidate 从 Agent / 智能体页面打开已发布公共页时使用与 Interviewer 相同的公开权限，不得因 owner 已登录而泄露额外内容；`/workspace/publish`、`/workspace/publish/preview` 与专用 `GET /api/publications/preview` 不再提供独立产品页面或预览后端。
5. Candidate 页面不再提供“候选人 Agent 链接”模块，专用 `POST /api/publications/link` 不再存在；发布概览、发布、访问和撤销保留各自仍被主流程使用的边界。

### 3.8 Interviewer 公共 Agent

1. 公共页面呈现 Candidate 授权的头像/姓名/头衔/地点/简介、Agent 状态、知识和 Citation 概况、公开亮点、推荐问题与 Chat-first 主区域。
2. Interviewer 首次进入任一公开 Agent 时获得由 localStorage 持有的 Browser Visitor Identity；同一浏览器再次访问时复用该身份，两个不同浏览器或浏览器 profile 必须得到不同身份。服务端只保存凭证 hash，不信任客户端声明的 owner、conversation 或 publication。
3. 同一游客可在每个 publication 下拥有多个独立 Conversation，并在左侧会话栏新增、删除和切换；会话列表按最近活动排序，标题来自该会话首条问题，空会话显示稳定的双语默认标题。切换后只加载所选 Conversation 的消息与推荐问题，刷新页面恢复最近活动会话。
4. 所有 Conversation 读写都同时验证当前 publication、Browser Visitor Identity 与 conversation id；不同游客、不同 publication 或伪造 conversation/message/run/source id 均不能读取、修改、监听、删除或反馈其他会话。删除一个 Conversation 级联删除其聊天内容且不影响该游客的其他会话；存在进行中 Deep Analysis 时明确拒绝删除，最后一个会话删除后客户端建立新的空会话。
5. 游客凭证通过受控请求同步到同源安全 cookie，以支持 EventSource、来源预览和新标签页；localStorage 是浏览器身份 owner。升级前按 slug 保存的旧 HttpOnly cookie 只允许在 session 初始化时迁移一次，不得让多个游客合并为共享会话。
6. 每个公共 Conversation 使用 30 天无活动滚动保留；每次有效访问只延长当前 Conversation 的保留时间。localStorage 被清除后下一次初始化创建新游客身份，旧 Conversation 集合不得自动投影给新身份。
7. 检索只使用 `citation_allowed` 和 `public_preview` 证据。回答中的 Citation 只展示来源名称，不展示类型、正文、摘要或证据片段；`citation_allowed` 不返回访问地址，`public_preview` 名称可打开来源。Markdown、PDF 在当前页居中预览，PDF 默认使用 A4 纸张比例，其他格式在新标签页打开；任何响应都不得包含内部存储路径。
8. 隐私越权、提示注入、索要完整知识库或无关问题必须被安全拒绝；回答不得把系统提示、密钥、私有资料或其他 Candidate 数据带入上下文。
9. 未发布、已撤销、被 Admin 暂停或不存在的 Agent 返回明确不可用页面，不泄露其私有状态。
10. 公共页面提供“分享 Agent 链接”操作；点击后复制浏览器当前页面 URL 并反馈结果，不创建或下载链接文件。
11. Interviewer 的问题与 Agent 回答按安全 Markdown 渲染；标题、列表、引用、链接、表格、行内代码和围栏代码块保持可读，原始 HTML、脚本和危险 URL 不得执行。

### 3.9 Platform Admin

1. Admin Overview 展示数据库实时计算的 Candidate、Published Agent、活跃 Interview、Citation 使用和被标记内容指标，以及最近发布 Agent、内容审查队列和时间范围趋势。
2. Candidates 页面支持搜索、状态查看和账号启停；Published Agents 页面支持搜索、查看公开页和治理暂停/恢复；所有动作写入审计记录。
3. Reports 页面展示可切换时间范围的真实聚合趋势；无数据时显示空态，不生成示例曲线。
4. Content Review 页面展示被安全规则、用户反馈或无引用回答触发的风险项；Admin 可记录 review、resolve、dismiss 结论，但不能借此展开私有原文。
5. Settings 页面展示 AI/数据库/worker 健康、模型名和非敏感运行配置，并允许管理不改变 Secret 的平台策略。Admin 邀请仅在明确配置邮件能力后可发送；否则显示未配置而不伪造成功。

### 3.10 UI、响应式与可访问性

1. 桌面端在 1448 × 1086 参考视口复现设计稿的固定侧栏、顶部栏、卡片层次、深墨绿主色、暖白纸张质感、水墨山水背景、衬线标题和红色印章点缀；直接复用已提供背景资产。
2. Candidate Workspace、公共 Agent 与 Platform Admin 使用各自正确的导航和身份标签；所有设计稿中的主要按钮、筛选、分页、搜索、下拉和导航均连接真实行为或明确的不可用状态。
3. Chrome DevTools 使用 `iPhone 14 Pro Max` 设备配置（430 × 932）时不产生横向溢出，导航可访问，主要操作与对话输入保持可用；桌面表格在移动端转为可读布局。
4. 键盘可完成注册、登录、忘记/重置/变更密码、导航、上传选择、筛选、隐私设置和对话；焦点可见，表单控件具有关联 label，状态不只依赖颜色表达。
5. 默认语言为 English，并提供 English / 简体中文切换；语言选择持久化，核心页面和错误反馈不得混用未翻译的界面字符串。
6. 全站无论是否登录、无论进入 Candidate、公共 Agent、Platform Admin、登录或邀请页面，都只在右上角显示同一个全局语言切换控件；页面、footer 与账号菜单不得再持有第二个语言入口。
7. Candidate Shell 不显示与一级导航重复的 Quick Action / 快捷操作，也不显示与 Agent 页面发布能力重复的 Invite Interviewers / 邀请面试官卡片。
8. 产品英文名保持 `Askme`，唯一中文名为“职问”；登录、Candidate、公共 Agent、Platform Admin、邀请与不可用页面中的品牌文字和印章不得再显示旧名“问候”。
9. Candidate Workspace 与 Platform Admin 页眉不显示搜索或快捷操作；通知、身份、语言和移动导航继续可用，Knowledge/Admin 领域页面自己的搜索能力不受影响。

### 3.11 AI、配置与本地运行

1. 默认 AI provider 为 DeepSeek OpenAI-compatible Chat Completions，默认 base URL 为 `https://api.deepseek.com`，默认 model 为 `deepseek-v4-flash`；可通过非 Secret 环境变量覆盖 base URL 和 model 以支持测试。
2. `DEEPSEEK_API_KEY` 按“进程环境优先，当前用户 `~/.env` 次之”解析；不得把真实密钥写入仓库、数据库、日志、浏览器 bundle、API 错误或测试快照。
3. 本地正式启动路径使用 Docker Compose，至少包含 Web、后台 worker、PostgreSQL 与可观察真实邮件的 SMTP 测试服务，并使用持久 volume 保存数据库和上传文件；重复启动不得清空数据。
4. 提供 migration、初始本地账号 bootstrap、健康检查、就绪检查和可恢复的停止/重启路径；仅显式 reset 才能清除本地数据。
5. 密码重置与 Admin 邀请复用同一服务端 SMTP transport；配置支持无认证或成对 username/password、显式 port/secure/from 和有界连接超时。未配置与发送失败必须返回稳定安全错误或防枚举受理语义，原始凭证、token 和完整邮件正文不得进入日志、审计或业务响应。本地 Compose 默认投递到 Mailpit，生产邮件供应商不属于本 Objective。
6. 两类邮件中的站内链接统一从 `ASKME_PUBLIC_BASE_URL` 构造，默认值为 `https://askme.monshunter.xyz/`；配置只接受无凭证、query、fragment 的绝对 HTTP(S) 根地址。邮件 URL 不读取请求 `Host` 或 forwarded host，覆盖配置时保留各模板自己的 `/reset-password/<token>` 与 `/invite/<token>` 路径。

### 3.12 质量与可观测性

1. 关键服务操作返回稳定错误码和可读反馈；服务端日志包含 request/job 标识但不包含密码、Token、Secret 或完整私有原文。
2. 资料处理、AI 请求、发布、撤销、权限变更和 Admin 治理动作具有可审计时间与结果。
3. 单元测试覆盖权限、可见性矩阵、检索过滤、配置解析和核心状态；集成测试覆盖数据库、文件处理、发布/撤销和聊天；真实浏览器 E2E 覆盖 Candidate 主闭环、Interviewer 对话、Admin 概览及桌面/移动布局。

## 4. 验收 Checklist

- [x] `AC-AUTH-001` Candidate 与 Admin 可使用真实凭证登录、恢复会话并注销，匿名权限被限制。
- [x] `AC-AUTH-002` 跨 Candidate 资源访问和错误角色操作被服务端拒绝，且测试证明 owner 隔离。
- [x] `AC-AUTH-003` Candidate 可完成自助注册、登录、注销、忘记密码邮件、单次重置和登录后改密；Admin 不能由自助入口创建，旧 token 与旧 session 在密码变化后失效。
- [x] `AC-AUTH-004` 忘记密码不泄露邮箱是否存在，认证入口具有输入边界、滥用防护和安全审计，密码与原始 token 不进入日志、URL query 或业务响应。
- [x] `AC-MAIL-001` 密码重置与 Admin 邀请通过统一 SMTP transport 真实投递，两类链接都使用 `ASKME_PUBLIC_BASE_URL` 且默认域名为 `https://askme.monshunter.xyz/`，请求 Host 不能改变邮件域名；配置和失败语义受测，本地 Mailpit 可分别观察两类邮件且不引入业务数据 volume。
- [x] `AC-DASH-001` Candidate Dashboard 的指标、最近资料、工作流与下一步全部来自当前数据库状态。
- [x] `AC-MAT-001` 六类文件的成功上传、50 MiB 边界和无效文件拒绝均有自动化或真实运行 Evidence。
- [x] `AC-MAT-002` GitHub、Notion 与 Website 至少各完成一次真实导入路径或可控官方 API 测试替身的契约验证。
- [x] `AC-MAT-003` 后台 job 可从 queued 收敛到 indexed/failed，失败可重试且不会重复派生数据。
- [x] `AC-MAT-004` 删除资料同步清理 owner 范围内文件和派生关系，其他资料与其他 owner 不受影响。
- [x] `AC-MAT-005` Candidate 工作区全部 Source Material 文件名可按格式打开 owner 文件，Markdown/PDF 当前页预览且 PDF 默认 A4，其他格式新标签页打开。
- [x] `AC-KB-001` Knowledge Base 的分类、搜索、筛选、分页和详情对真实索引结果生效。
- [x] `AC-KB-002` Candidate 编辑知识摘要后持久化且保留来源与 Citation 追溯。
- [x] `AC-PRIV-001` 四级可见性矩阵由服务端统一执行，Candidate 预览与公共回答的证据集合符合合同。
- [x] `AC-PRIV-002` 隐私修改即时影响后续公共请求，确认状态被持久化；当前修订已确认时确认按钮隐藏，来源可见性变更后显示“再次确认”。
- [x] `AC-PRIV-003` `citation_allowed` 公共 Citation 不含访问地址，`public_preview` 才能打开来源；权限、publication 或 owner 状态变化后旧访问请求立即失败。
- [x] `AC-AGENT-001` Candidate 预览对话使用真实检索和 DeepSeek 回答并返回真实 Citation。
- [x] `AC-AGENT-002` 无证据、AI 未配置、超时和上游失败具有不同反馈且不产生伪造答案。
- [x] `AC-AGENT-003` 推荐问题、Answer Tone、Public Mode、Privacy-Safe Mode 与回答反馈可交互并持久化。
- [x] `AC-AGENT-004` Candidate Workspace 只保留 Agent / 智能体一级入口，预览问答、设置、直接发布、发布后访问和撤销在该页面形成闭环，独立链接模块、链接生成 API、发布页面与专用 Candidate 公共预览 API 不再存在。
- [x] `AC-AGENT-005` Candidate 预览的用户问题和 Agent 回答安全渲染 Markdown，且 Citation 中的来源文件名可按 owner 权限查看。
- [x] `AC-PUB-001` 发布前置条件、发布时生成的不可推断链接、历史 draft 兼容、持久发布状态、撤销与再发布行为通过集成测试。
- [x] `AC-PUB-002` Candidate 公共预览与匿名 Interviewer 使用完全相同的公开权限。
- [x] `AC-PUB-003` 公共 Agent 页的“分享 Agent 链接”复制当前页面 URL、反馈成功或失败且不下载文件。
- [x] `AC-PUB-004` 缺少职业头衔的现有 Candidate 与新注册 Candidate 都可从发布阻塞项直达公开资料编辑，只能更新当前账号，补齐后返回 Agent 页面并成功发布；已有完整身份的 Candidate 不受影响。
- [x] `AC-CHAT-001` 匿名访客可在已发布 Agent 上进行持久多轮对话，并获得真实 Citation。
- [x] `AC-CHAT-002` 私有数据、跨 owner 数据、未公开原文件访问、提示注入和完整知识库索取被拒绝或隔离。
- [x] `AC-CHAT-003` 未发布、撤销、暂停与不存在的 Agent 均不可对话且不泄露私有事实。
- [x] `AC-CHAT-004` 公共问答安全渲染 Markdown；Citation 只展示来源名称，并仅为 `public_preview` 提供按格式打开来源的能力。
- [x] `AC-CHAT-005` 同一浏览器的 localStorage 游客身份可恢复各 publication 的独立 Conversation 集合；两个浏览器、两个 publication 及伪造 conversation/message/run/source 请求均不能互读互改，旧 slug cookie 可一次迁移且不会形成共享会话。
- [x] `AC-CHAT-006` 游客可在公开 Agent 左侧会话栏新增、删除、切换和恢复多个聊天记录；每个会话的消息、推荐问题、反馈与 Deep 状态独立，删除不影响其他会话，桌面与移动端均可完成操作且无横向溢出。
- [x] `AC-ADMIN-001` Admin Overview 的全部指标、最近发布、审查队列与趋势来自真实聚合数据。
- [x] `AC-ADMIN-002` Candidate、Published Agents、Reports、Content Review 与 Settings 导航均具备合同定义的真实读写闭环。
- [x] `AC-ADMIN-003` Admin 治理不能读取 Candidate 私有原文，账号/Agent 状态动作具有审计记录。
- [x] `AC-UI-001` 七个参考主界面在 1448 × 1086 的结构、视觉语言与关键几何经 Chrome 截图对照验收。
- [x] `AC-UI-002` Chrome DevTools `iPhone 14 Pro Max`（430 × 932）下无横向溢出，导航、表单、隐私控制与 Chat 可完成真实操作。
- [x] `AC-UI-003` 关键流程可键盘操作并具有可见焦点、label 和非颜色状态表达。
- [x] `AC-UI-004` Candidate Shell 不再显示重复语言切换、Quick Action / 快捷操作、Invite Interviewers / 邀请面试官或 Publish Agent / 发布 Agent 入口。
- [x] `AC-UI-005` 登录前后全部产品页面只在右上角显示一个全局 English / 简体中文切换控件，切换后同一 locale cookie 驱动当前页面重新渲染，页面、footer 与账号菜单没有第二入口。
- [x] `AC-UI-006` 全部产品页面的中文品牌文字与印章统一显示“职问”，代码和渲染结果均不再将“问候”作为 Askme 中文品牌名。
- [x] `AC-UI-007` Candidate 与 Platform Admin 页眉不再显示搜索或快捷操作，其他页眉功能、移动导航和领域页面搜索保持可用。
- [x] `AC-I18N-001` English / 简体中文切换持久化并覆盖核心页面、操作反馈和错误状态。
- [x] `AC-AI-001` 运行时按优先级读取 DeepSeek 配置，真实 API health/chat 验证使用 `deepseek-v4-flash` 且不泄露 key。
- [x] `AC-OPS-001` Docker Compose 可从空数据库启动 Web、worker、PostgreSQL 并通过健康检查。
- [x] `AC-OPS-002` Docker restart 保留账号、资料、知识、会话和文件；reset 只能由显式命令触发。
- [x] `AC-OBS-001` 关键错误码、job/请求追踪和审计记录可复核且无 Secret 或完整私有原文泄露。
- [x] `AC-TEST-001` 单元、集成、构建、migration、Docker smoke 与 Chrome E2E 在当前 revision 全部通过。

## 5. 假设与开放决策

- 根 Spec 与设计稿没有指定生产域名、邮件服务、对象存储或商业计费；本 Objective 采用单机 Docker、PostgreSQL 与持久本地 volume，不声明生产就绪。
- Platform Admin 的导航来自设计稿但产品正文未定义细节；本合同选择满足治理闭环的最小行为，不增加 ATS、评分或招聘决策。
- 对外部 GitHub、Notion 和 Website 的最终真实验收受可用公开资源或 Candidate 凭证影响；实现必须支持真实官方接口，同时允许用可控契约测试证明失败与数据映射，不能把未调用的第三方服务报告为已通过。
