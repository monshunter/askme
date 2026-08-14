# REVIEW-087：PLAN-016 Agent 精准问答与上下文推荐 Change Review

## 审查对象

- Objective：`OBJ-011`
- Plan：[PLAN-016](../plans/PLAN-016.md)
- Spec：[SPEC-002](../specs/SPEC-002.md) `AC-ANSWER-001`、`AC-DEEP-001`、`AC-USAGE-001`、`AC-SUGGEST-001`、`AC-LANGUAGE-001`
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- 分支：`fix/agent-answer-routing-and-suggestions`
- 审查日期：2026-08-14

## 正确性与边界

- Approved Wiki 仍是长期 Repository RAG 的唯一源码知识入口；检索先用问题实体确定 Repository，再按内容词匹配 section。Repository 名称不再让每个 Wiki 页面的首段都成为候选，copybook 概览只命中 Overview 与直接支撑项目技术栈的来源。
- RAG 模型必须对 Repository Evidence 返回实际使用的 `[S*]` marker；Host 拒绝缺失、越界或其他 Evidence 的 marker，并只持久化所选 marker 对应的源码范围。文档 Citation 继续按 Evidence 选择，不接受 Repository marker。
- 身份、权限、visibility、问题范围、公开开关和资源门禁先于 Router。Router 只建议 `rag`、`deep` 或 `refuse`；Host 对低置信 Deep、未经确定性门禁确认的模型拒绝和不可授权 Repository 做有效路由收敛，并以不含问题正文的稳定 reason code 审计。Review 中发现 Candidate 越界范围门禁未与 Public 共用，已收敛到共享 Host policy 并用定向测试 Reconcile。
- Conversation Deep 不读取或消费 `analysis_quota_usage`，也没有 public session 日问题次数设置；短窗口防滥用、并发、deadline、round、tool、token、microVM 资源和 Repository Wiki 离线生成配额保持有效。
- 推荐问题归属具体 Conversation。空会话使用当前授权知识生成引导问题；回答终态后读取该会话全部已落库、可见且完成的用户与 Assistant 消息，由 Router profile 的 LLM 生成四个同语言追问并保存 context hash。刷新只增加同一 Conversation cursor；LLM 失败时才使用当前主题 fallback，optimistic row version 防止慢结果覆盖新上下文。
- RAG、Deep、证据不足、拒绝与推荐均以最后一条用户问题为语言 owner；源码标识符、路径和专有名词不被错误计为整体语言不一致。Deep 修正 prompt 重新携带原问题，避免新 guest session 丢失语言与任务上下文。

## 安全、兼容与恢复

- 新 migration `0018_conversation_suggestions.sql` 只为 Conversation 增加推荐数组、context hash 与更新时间，数组只允许 0 或 4 项，hash 只接受 SHA-256 十六进制；旧 Agent Settings 推荐列保留但不再作为运行 owner，无破坏性回填。
- Candidate/Public Conversation、Citation 与推荐查询都复核 owner、mode、publication、visibility 和当前消息状态；Public Citation 继续按 visibility 投影，Deep 原始源码结果不进入 Wiki、Knowledge Item 或 RAG。
- Router audit 只保存 conversation id、requested/effective route、reason code、confidence、Repository id 和 Evidence count，不保存问题正文、prompt、源码、reasoning 或 Secret。
- 本地 Compose 保留 volume 重建前后数据计数一致：`users=2`、`materials=2`、`knowledge_items=18`、`repositories=2`、`conversations=13`、`messages=76`、`analysis_runs=39`；最新 migration 为 `0018_conversation_suggestions.sql`。

## 当前 Evidence

- `npm test`：75 files / 265 tests PASS；`npm run lint`、`npm run typecheck`、`npm run build`、`npm run verify:surface-matrix`、`git diff --check` PASS。surface matrix 为 18 pages、60 API routes、66 methods、27 verification entrypoints。
- Compose 网络内 `smoke:agent-preview`、`smoke:public-chat`、`smoke:admin` PASS，覆盖 Candidate/Public 推荐刷新、Citation、越界/注入拒答、证据不足、幂等、限流、撤权、Admin policy 与审计。
- 最终已部署版本的 `smoke:agent-runtime-acceptance` PASS：copybook 概览只选择 `README.md` 与 `package.json`；Candidate Deep run `6a0dee4f-50ac-4489-a11f-bd709225ccf5` 和 Public Deep run `fc144cd2-7dc2-46f7-a575-afd0c74687d5` 均由真实 `conversation_analysis` 完成；Candidate 返回 `src/lib/pdfGenerator.ts` 精确范围，Public 返回四条授权投影 Citation；两端回答与四条 LLM 推荐均为中文，配额快照未变化，Deep 路由审计成立。
- 真实浏览器 Candidate 会话中，copybook 概览来源面板只显示 `README.md:1-100` 与 `package.json:1-42`；Deep 回答显示十个 `src/lib/pdfGenerator.ts` 精确范围，四条推荐随 PDF 主题更新。Public 新会话概览同样只有两个相关来源，推荐随该会话更新为四条 copybook 中文追问；Candidate/Public console error 均为 0。
- 部署后 readiness 的 database、migration、worker、runner、artifact、boxlite、provenance 与 AI 全部为 `ready`，Code Agent capability 为 `ready`。

## 发现

没有阻塞正确性、安全、兼容、恢复或验收的剩余发现。

非阻塞边界：当前检索是 PostgreSQL 全文/词法检索与直接 Approved Wiki section 加载，不是向量检索；Agent 问答不受日次数配额限制，但短窗口防滥用、并发和单次运行资源预算仍会拒绝不安全或超载请求。未来 Token/积分余额未在本次引入。

## 结论

`PASS`

PLAN-016 已满足精准 Citation、真实 Candidate/Public Deep、无问答日次数配额、同语言回答及会话级 LLM 推荐目标。下一路由：同步文档索引并对账 Plan、Progress 与 Git 后创建原子 Commit，关闭 OBJ-011。
