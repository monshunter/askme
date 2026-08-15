# REVIEW-127：DESIGN-005 Agentic Query Understanding Design Review

被审制品：`DESIGN-005`

Revision：`sha256:4321ffee9700b2f0d5698c2b62a33d0a39ae41f3e809cceb8e98a041694ed45a`

Verdict：`PASS`

## 审查结论

- Context Packet 只包含当前问题、同一授权 Conversation 的有限最近消息、当前问题内 Catalog candidate、可信 Trace focus、deterministic seed 和 allowed evidence type；不向 Query Agent 暴露 Catalog 全量、Evidence、Secret 或跨 visitor/owner 上下文。
- 初始 Query Agent 与条件 Adjudicator 使用同一受控 Provider Profile 但不同 system contract，最多各一次；触发条件覆盖 hard-stop、entity role/subject 冲突、低置信、空 requested fields 和真实多义，不形成无界循环。
- `Named Entity Mention → required | context` 与 `focused | discovery | clarify` 明确分离。Entity Resolver 只消费 required mention；Catalog 命中不自动 hard scope，Context Mention 也不能触发 Deep。
- Host finalizer 的依赖方向单向：可信 span/Trace/权限不变量约束 Agent 输出，Agent 不访问数据库或工具，Provider 失败回 deterministic semantics；没有双重事实源或循环授权。
- Requested Fields 生成 answer aspects，subject/scope/time 保持 constraints；四路检索实际消费 allowed evidence type、scope/fields/time expansion，修复了 V3 只把 `desiredEvidenceTypes` 写入 Trace 的空合同。
- Temporal annotator 只在请求态标记 overlap/outside/unknown，不写回业务数据；unknown Evidence 仍由 Answerability 看原文，outside 不能单独支持时间问题，兼顾 exact-match 假阴性和错误区间假阳性。
- V4 不改变 embedding/chunk schema，直接切换 retrieval policy；完整重建是本次干净派生数据验收动作而非伪装成 schema 必需 migration，失败时旧 active index 可继续服务。
- Trace、指标与三层 Eval 能定位 initial/adjudication/fallback、entity role、discovery false-none、clarify、time overlap 与 Citation；批准集要求四类已知错误为 0，但不对开放语言作不可验证的数学绝对承诺。

下一路由：使用 `autogo-tdd` 从 PLAN-026 Phase 2.1 建立 Query Semantics、Agent adjudication、entity role、time overlap 与对偶回归失败测试，再进入最小实现。
