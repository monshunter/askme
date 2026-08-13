# REVIEW-054：DESIGN-005 Design Review（初审）

## 审查对象

- Objective：`OBJ-008`
- Plan：[PLAN-013](../plans/PLAN-013.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- Revision：`DESIGN-005 sha256:66c37dc3c378445238a73f3829616e7b3cddc410de5075061544c94a0b6d3d44`
- 审查日期：2026-08-13

## 通过项

- Repository、Dossier、文档检索、Router、Host Runner、BoxLite guest、Pi 与外部 OpenAI-compatible endpoint 的职责单一，未引入 Host LLM Gateway 或 System Operations Agent。
- Request-time GitHub fetch 解决了私有 Token 无法安全进入异步 job 的矛盾；后续 artifact processing 和 analysis run 都不依赖 GitHub credential。
- PostgreSQL lease/version 是持久事实，`NOTIFY` 只作唤醒，SSE snapshot 可以恢复丢失事件；无需 V1 消息中间件或 WebSocket。
- 产品 Skill 与开发 Harness 分离在 `src/server/code-agent`，custom loader 和固定 tool registry 阻断 Repository 指令文件成为运行配置。
- per-run microVM、no host mount、egress allowlist、Host Citation validation、配额和历史 artifact retention 覆盖主要隔离与成本风险；BoxLite 最低版本与 SDK watchdog 有外部依据。

## 必须修正

1. **Run completion 与 cleanup 顺序冲突**：8.1 的阶段文本写成“persist terminal result → cleanup”，但同节正文和状态图又要求 cleanup 失败不能进入 `completed`。如果实现按阶段文本先提交 completed，cleanup 失败就需要反向改写终态，破坏终态单向性，也可能让浏览器提前读到答案。应把 validated result 暂存在 Runner 内存，先完成并确认 microVM cleanup，再在持有当前 lease 的事务中提交 `completed` 与最终资源；cleanup 失败只提交 `failed` 并丢弃未发布结果。
2. **Revision 与 Dossier 状态被同一图混合**：第 6 节让 `active → analyzing`，会误导实现修改当前 active Revision，而 Spec 要求新 Revision 或同 Revision 重分析期间旧 active Revision/Approved Projection 继续服务。`stored` 也缺少 visibility 提升后的分析转换。应拆开 artifact/Revision readiness、Dossier generation/review 与 Repository active pointer，明确只有 Candidate approval 事务更新 active pointers。

## 结论

`FAIL`

下一路由：返回 `autogo-solution-design` 修订以上状态与提交顺序；修订后重新执行 Design Review。其他通过项无需扩大设计范围。
