# REVIEW-068：SPEC-002 Code Agent 模型窗口增量 Spec Review

## 审查对象

- Objective：`OBJ-009`
- Plan：[PLAN-014 Phase 7](../plans/PLAN-014.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Revision：`SPEC-002 sha256:7cf0061644b8ec36134f1443baeb33266b689824c44952c178686d23fce37725`
- 审查日期：2026-08-13

## 一致性与边界

- Code Agent 默认最大输入上下文明确为 1,000,000 tokens，单次模型输出上限明确为 200,000 tokens；两者不再由旧 4,000 tokens 值或 `output × 8` 推导。
- 模型窗口只替换该 Profile 的输入、输出默认值，不改变 50 个 rounds、40 次工具调用、超时、聚合工具输出、单次读取、搜索、microVM 资源、并发和多层配额边界。
- Repository Analysis 与 Deep Analysis 继续使用同一 Code Agent Profile；所有默认值仍允许开发者配置，没有新增第二套模型预算 owner。

## 可测试性

- 配置测试可独立断言 Code Agent Profile 默认 `contextWindow=1_000_000`、`maxTokens=200_000`，显式覆盖与非法值继续 fail closed。
- sandbox 请求合同可断言传给 Pi 的 `contextWindow` 与 `maxTokens` 精确等于配置值，且 DeepSeek `thinking` 兼容字段不改变这两个数值。
- 固定 public Revision 必须在新预算下生成通过 Host schema、Citation、Revision、权限和预算校验的真实 Dossier；只验证配置对象或 mock provider 不算质量验收。

## Findings

无阻塞 finding。实现必须移除当前 `Math.max(32_000, maxTokens * 8)` 推导，并将 context window 纳入 Profile fingerprint，避免旧 run 在新模型窗口下被错误重放。

## 结论

`PASS`

下一路由：在 PLAN-014 Phase 7 当前 run 内同步配置、provenance、guest 控制输入、示例与测试，然后重建、保留数据部署并重新执行固定仓库验收。
