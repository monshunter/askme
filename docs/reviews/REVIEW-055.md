# REVIEW-055：DESIGN-005 Design Review（复审）

## 审查对象

- Objective：`OBJ-008`
- Plan：[PLAN-013](../plans/PLAN-013.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- 前次审查：[REVIEW-054](REVIEW-054.md)
- Revision：`DESIGN-005 sha256:b057a06612cf8405f02e99274df3e5ec2ef7f2cc4f2c6ad445efbe1c1aa21e90`
- 审查日期：2026-08-13

## Reconcile 结果

- Run 顺序已改为“Host 内存校验 → microVM cleanup → 持有当前 lease 的事务提交 completed/final resource”。Web 不会在清理成功前读到结果，cleanup 失败只产生 `failed`，终态不再反向改写。
- Revision artifact readiness、Dossier generation/review 与 Repository active pointers 已拆成三个事实 owner。`private stored → visibility raised → Dossier run` 有明确路径；新 Revision 或重分析不会修改旧 active pointers，只有 Candidate approval 事务切换。

## 边界、风险与复杂度

- 方案复用 PostgreSQL、现有文档检索和 Compose 服务，只新增业务确需的 Repository domain、artifact store、Host Runner 和 one-run BoxLite；没有引入向量库、消息中间件、语言索引服务或 System Operations Agent。
- Web、ordinary worker、Runner、guest 和外部 AI endpoint 的信任方向单向清楚。Pi 在 guest 内直接调用 endpoint，不需要 Host LLM Gateway；Token/AI key 的请求内、Host、guest 和销毁边界明确。
- Generated Dossier、Approved Projection、会话答案、Revision artifact 和 Citation retention 各有独立生命周期；旧 active 服务、新 draft 审核和运行版本过期可以同时存在而不覆盖。
- PostgreSQL lease/version + NOTIFY/SSE 允许 crash、丢事件和重连收敛；配额、realtime slot、watchdog、取消、Citation validator 和 cleanup 覆盖容量悬崖与失控 run。
- migration 允许开发期移除旧 GitHub material 与 DeepSeek adapter，但仍采用 additive → consumer switch → removal，且 feature flag/runner stop 提供可逆止损。

## Notes

- 实施时必须 pin BoxLite、Pi 和 `openai` 的精确版本/image digest，并用 guest/image contract 证明 network deny、no host mount、hard watchdog 与 credential absence；官方能力说明不能替代当前版本的运行 Evidence。
- macOS Hypervisor.framework 与 Linux KVM 的服务安装方式属于后续部署制品，本设计只拥有必须满足的平台边界。

## 结论

`PASS_WITH_NOTES`

Notes 不改变 Spec、安全、成本或恢复方案。可以批准 `DESIGN-005` 并进入文档一致性验证和 Change Review。
