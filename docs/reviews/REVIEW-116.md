# REVIEW-116：PLAN-024 公共 Agent 相关性修复 Change Review

Verdict：`PASS_WITH_NOTES`

- Objective：`OBJ-019`
- Plan：[PLAN-024](../plans/PLAN-024.md)
- Bug：[BUG-005](../bugs/BUG-005.md)
- Operation：[OP-008](../operations/OP-008.md)
- 审查分支：`fix/public-agent-relevance-guard`
- 审查日期：2026-08-15

## 审查范围

审查 Evidence Judge 的核心实体 Coverage、RAG 证据不足后的 Repository fallback、Public Chat 与 Candidate Preview 两个 consumer、测试、保留数据 Compose 部署、真实“牛鼻子”API/浏览器验收和清理结果。来源权限、索引 schema、Provider、Secret、UI、host-native Runner 恢复、生产环境与既有未跟踪 `NOTES.md` 不在本次 Diff 或 Commit 范围。

## Findings

没有阻断或仍需修复的 correctness、安全、权限、兼容、部署或验收发现。

实施和审查过程中发现并已 Reconcile 的问题：

1. 第一版核心实体门禁位于冲突判断之后，OneCat 文档中的通用“项目”和无关正反句会先把 Askme 判为 `conflicted`。门禁已移动到冲突判断之前；失败测试复现两组独立 OneCat family 后，Askme 稳定收敛为 `none`。
2. Coverage 修复后，Public Chat 仍会把唯一 OneCat 无条件作为 RAG insufficient 的 Deep fallback。两个 consumer 已改为保存 Router 的原始选择，不再从 Repository 数量猜测。
3. 初版 Router 选择修复仍把模型返回的 Repository ID 当成唯一确定 Evidence。Change Review 新增失败测试并进一步收紧：只有问题文本明确点名同一个授权且允许 Deep 的 Repository 才能 fallback；`Askme + Router 误选 OneCat` 返回 null，显式 `OneCat` 仍保留合法 fallback。

## 正确性、范围与兼容结论

- `SPEC-002` 已规定核心方面均无支持时为 `none`，实现现在优先使用 Planner entities，再在实体无字面支持且 Rerank 降级或低于既有相关性门槛时 fail closed；无须新增 Spec 或 Design。
- 强语义 Rerank、相关实体和多轮已解析指代测试继续允许 `partial/full`，修复没有退化为全文字面匹配。
- Public Chat 与 Candidate Preview 使用同一个确定性 fallback helper；Repository 在请求期间权限变化时，consumer 会在真正排队前重新加载并再次检查 `deepAllowed`。
- Router 直接判定高置信 Deep 和确定性的源码检查入口没有改变；只收紧 RAG 已返回 insufficient 后的二次升级，不改变持久数据、API response schema、Citation 或会话合同。
- 无 Migration、Secret、权限、索引或生产变更。Compose 使用既有保留数据入口，volume 创建时间和非验收业务计数稳定。

## 当前 Evidence

- 自动化：Vitest `101 files / 364 tests`、ESLint、Next typegen + TypeScript、production Build `31 / 31`、Surface Matrix `22 pages / 68 API routes / 76 methods / 29 verification entrypoints` 与 `git diff --check` PASS。
- Runtime：最终 migrate exit 0、Web healthy、worker running，ready 顶层为 `ready`，database/migration/worker 为 `ready`，AI 为 `configured`；最终部署后的应用错误/警告日志为空，active Analysis Run 为 0，PostgreSQL/uploads volume 未替换。
- API：直问 Askme 与 OneCat 后追问 Askme 都是 HTTP 200、`INSUFFICIENT_EVIDENCE`、0 Citation、`coverage=none`；OneCat 是 HTTP 200、正常回答、6 Citations。
- Browser：最终镜像新会话可见 OneCat 正常回答和 6 个公开来源，随后 Askme 显示证据不足和“需要更多证据”；刷新后 4 条消息持久存在，`clientWidth=scrollWidth=1280`，Console warning/error 为 0。
- 清理：中途错误排队的唯一 pending Deep run 已按状态机取消并保留审计；当前 pending/running run 为 0。

## Notes

- `smoke:public-chat` 的 Orion fixture 只创建 V1 `chunks` 而未建立 V2 RAG source/evidence，父提交同样会在空 V2 Evidence 下返回 `none`。该既有 fixture 漂移已如实记录，未作为 PASS，也不影响本 Plan 基于现有发布账号、真实 V2 Evidence、HTTP 和浏览器的验收。
- host-native Runner stale、artifact degraded、BoxLite unavailable、provenance unverified 是本次开始前已存在的 Code Agent 运行状态；Public RAG 路径、Compose Web/worker 与本目标验收不依赖它们。本 Review 不声称 Code Agent 已恢复。

## 结论

最终 Diff、Spec、测试、两个 consumer、部署、真实 API、浏览器、数据保留和清理 Evidence 与 `OBJ-019 / PLAN-024` 一致。Notes 不影响公共 Agent 的相关性、权限、可恢复性或验收结论；`PLAN-024 4.1` 可以完成并进入 `autogo-change-close`。
