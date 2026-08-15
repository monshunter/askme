# REVIEW-125：SPEC-002 Agentic Query Understanding 补充需求重审

被审制品：`SPEC-002`

Revision：`sha256:b06922e0d458dc3b15de524d0d88d5ab2d1d0512e3b410a9b6caf30f628a10d4`

Verdict：`PASS`

替代关系：本 Review 替代用户补充目标前、绑定旧 revision 的 [REVIEW-124](REVIEW-124.md)；不改写历史结论。

## 审查结论

- Query Understanding 被定义为真正的有界 Agent 能力，而非对 `你在哪家` 的单条规则修补：初始 LLM 结合当前问题、受控最近会话、Host seed、当前问题内 Catalog candidate 与上一轮可信 Trace，冲突或 hard-stop 风险下再进行一次独立语义裁决。
- `Named Entity Mention`、`Required Entity` 与 `Context Mention` 分离；名称仅仅出现在问题里不自动建立 source hard scope，解决 incidental mention 假阳性，同时保留 unknown required entity 的严格 failed-close。
- `focused | discovery | clarify` 三种 mode 覆盖明确主体、待求对象和真实多义。低 confidence 只触发裁决与诊断，不直接批量拒答；无法消解的真实歧义要求澄清，不伪装成资料不存在。
- Host 仍拥有 span、枚举、Catalog identity、上一轮焦点、权限和 Entity Scope 不变量；LLM/Agent 不能扩大 tenant、visibility、source 或工具能力，因此灵活意图理解没有削弱安全边界。
- Provider 全失败时的 fallback 是保守但可用的语义策略：明确 target 语法和可信唯一上下文才 focused，其余 discovery；问词、代词、待求字段仍不能成为 Entity。
- Query Semantics、Entity role、Agent adjudication、time overlap、requested-field coverage 和 Trace 均有稳定验收项；成对评测要求 approved dataset 内 required-role 假阳性、漏识别、无实体 false-none 与跨实体替代均为 0，同时没有对开放语言做不可验证的绝对零错误承诺。
- 更新继续复用现有 `SPEC-002`、Entity Catalog、Hybrid Retrieval、Answerability 与 Claim/Citation owner，没有引入长期记忆、通用 Agent Framework、Knowledge Graph 或第二套授权事实源。

下一路由：更新并审查 `DESIGN-005`，将两阶段 Agent、上下文包、实体角色裁决、Query Mode、时间约束与降级状态落到当前运行时。
