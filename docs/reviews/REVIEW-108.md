# REVIEW-108：DESIGN-005 Host 年限派生 Design Review

被审制品：`DESIGN-005`

Revision：`sha256:d13aaca2371e47578dcdac4125e771d255b7ce13807a2a5b42e1611d55a454e3`

Verdict：`PASS`

## 审查结论

- Host 年限派生仅在单方面职业年限问题中启用，起点来自已通过独立 Claim Verifier 的 Claim；无法识别受控起点语义时回退普通已验证回答，不直接从原始 Evidence 猜测日期。
- `currentDate` 在请求开始时冻结一次，Provider 遗漏时长或返回旧年份时由 Host 统一重算，避免模型训练截止时间和跨阶段取时钟影响结果。
- 派生文本复用原 Claim 的 Citation，没有新增无来源职业事实、权限通道、持久状态或 Provider 调用。
- 多方面问题仍由 `answerAspects` 顺序、覆盖和缺口合同负责，Host 年限兜底没有形成第二套复合回答流水线。
- 单元测试同时覆盖旧年份改写与时长遗漏补全，真实 Public Agent 已显示 2026 年和约 9 年；当前设计具有直接失败路径和可验证回退。
