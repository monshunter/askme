# REVIEW-112：PLAN-022 公开 Agent 与预览会话体验 Change Review

Verdict：`PASS_WITH_NOTES`

- Objective：`OBJ-017`
- Plan：[PLAN-022](../plans/PLAN-022.md)
- Spec：[SPEC-001](../specs/SPEC-001.md) `sha256:e4957aeea7c3378562993817e0be3a0ca1e94100e0c8e9eea8a2c2bcc2c2a0d4`
- 审查日期：2026-08-14

## 审查范围

审查公共 Agent 的语言入口、右侧栏与推荐问题，Candidate 预览会话重置的确认、权限、并发和保留语义，以及自动化、Docker 保留数据重部署和真实桌面/移动浏览器结果。公共游客身份、多会话、RAG 回答质量、Repository Deep Analysis、知识内容、发布生命周期和生产发布不在本次变更范围；无关未跟踪文件 `NOTES.md` 不进入本次 Diff 或 Commit。

## Findings

没有阻断或需要继续修复的 correctness、安全、兼容、数据或范围发现。

审查和真实浏览器验收中发现并已 Reconcile 的问题：

1. 旧移动端 CSS 仍为过去的浮动语言入口在 `.public-trust` 右侧预留 `124px`，导致 390px 视口中两个控件分离并产生横向溢出；现已删除遗留间距，并用结构合同和真实移动视口锁定 8px 相邻间距与无横向溢出。
2. 初始重置只在同一浏览器标签页通过 `sending` 状态阻止回答生成中操作，另一标签页仍可能并发调用重置 API；现由回答创建和重置共享 Candidate owner 级 advisory lock，并在 pending 回答或 Deep Analysis 存在时返回 `409 PREVIEW_SESSION_BUSY`。

## 正确性、权限与兼容结论

- 根布局只在非 `/a/` 页面渲染固定全局语言入口；公共 Agent 在“可信且公开”之后渲染唯一的页眉语言入口，使用同一 locale 持久化组件且自身不是 fixed、sticky 或 absolute。
- 公共 Agent 右侧栏只保留实际 Candidate highlights；推荐问题复用 Candidate 预览的 `suggestion-section`、标题、刷新操作、双列/单列网格和点击发送语义，没有新增第二套状态或接口。
- `DELETE /api/agent/preview` 只允许 Candidate 会话，所有读取、锁定和删除均限定当前 `owner_id` 与 `mode='preview'`；事务内级联删除旧预览会话、建立一个新空会话并记录不含问答正文的 `agent.preview.reset` 审计。
- 重置不删除知识、Agent 设置、发布状态、AI 用量或历史审计；另一 Candidate 的 preview Conversation 与 Message 不受影响。pending 回答或 Deep Analysis 会阻止重置，不会留下半清理状态。
- 没有 Migration、Secret、公共游客权限、公开数据投影或不可逆部署动作；现有 preview 数据只在 Candidate 明确确认后由新 API 删除。

## 当前 Evidence

- 工程门禁：`git diff --check`、ESLint、Next typegen + TypeScript、production build PASS；Vitest `101 files / 360 tests` PASS；surface matrix 为 `22 pages / 68 API routes / 76 methods / 29 verification entrypoints`。
- Runtime smoke：最终 Web 镜像上的 `smoke:agent-preview-reset` 验证 pending 回答保护、owner 隔离、级联清理、新空会话以及设置、知识、AI 用量、审计保留，事件为 `smoke.agent-preview-reset.completed`。
- Runtime：使用 `scripts/docker-up.sh -d` 保留 `askme_local_pgdata` 与 uploads volume 重部署；live 为 `live`、ready 顶层为 `ready`，Web healthy、worker running、migrate exit 0，近十分钟 Web/worker 错误日志为空。测试夹具和公开问答副作用清理后，部署前后均为 `4 users / 4 materials / 35 conversations / 192 messages / 100 rag_source_versions`。
- Browser desktop：公共页语言入口位于 trust 右侧 20px，computed position 为 `static`，页面滚动 344px 后入口离开视口；右侧没有“还想了解更多”，推荐问题为 2 列、4 个可用按钮，点击后真实发送并显示用户问题。
- Browser mobile：390 × 844 视口无横向溢出，语言入口与 trust 相邻 8px，推荐问题为单列 4 项；Candidate 预览确认框说明清理与保留边界，确认后消息为 0、Citation 为 0、推荐问题为 4，回答语气、公开模式和隐私安全模式保持原值。公共页与预览页 console warn/error 均为空。

## Notes

- 既有 `smoke:agent-preview` 的回答断言仍使用旧 `chunks` 夹具，而当前 Hybrid RAG V2 只从 active `rag_source_versions` 检索，因此会在本目标之前的 grounded-answer 步骤得到 `INSUFFICIENT_EVIDENCE`。本次没有修改该历史夹具；新增的 reset smoke 独立覆盖本目标 API、数据库和页面边界。该 note 不影响本次重置、公共页 UI 或运行验收结论。
- `/api/health/ready` 顶层为 `ready`，但与本目标无关的 Code Agent capability 因本地 runner stale、artifact degraded 与 BoxLite unavailable 标记为 degraded；Candidate/Public Agent Web、数据库、migration、worker 与 AI 配置均达到本目标运行条件。本 Review 不外推为 Code Agent 或生产环境验收。

## 结论

Spec、Plan、实现、自动化、最终 Docker 运行版本、真实浏览器结果和 Git 范围一致。Notes 不影响四项用户目标、owner 隔离、数据保留或恢复路径；`PLAN-022 4.3` 可以进入 `autogo-change-close` 对账、关闭与原子提交。
