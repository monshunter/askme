# REVIEW-091：PLAN-017 统一 SMTP 范围调整 Plan Review

## 审查对象

- Objective：`OBJ-012`
- Plan：[PLAN-017](../plans/PLAN-017.md)
- Revision：`PLAN-017 sha256:768bad116c53f4ae2e380ded9676032836409ed741a972bece7f9bf1159be757`
- 关联合同：[SPEC-001](../specs/SPEC-001.md) `sha256:1c3396d3eeadf2ae85b7101c2bf4fff57fb10bad49f74152c89ca23fd06cb059`
- 关联设计：[DESIGN-001](../architecture/DESIGN-001.md) `sha256:0ec7e79b5c0996e2b8bf24fb5596ab50db0087b5354db44489cc131e0f30820b`
- 审查日期：2026-08-14

## 覆盖与顺序

- 调整后的 Plan 把用户新增的完整 SMTP 要求收敛到现有 Objective：密码重置与 Admin invitation 复用统一 transport，并分别通过 Mailpit 真实投递；没有把它扩大为生产邮件供应商选择或部署。
- Phase 3 先统一连接、认证、TLS、超时、关闭和安全错误 owner，再执行两类邮件的运行验证；该顺序避免两个领域模板继续维护平行 transport。
- 原有 Candidate 认证、游客隔离、Citation 修复、保留数据部署和浏览器验收仍保持原顺序与完成事实，不需要重做已通过的 Phase Item。

## 粒度、风险与验收

- `3.4` 只负责统一 SMTP transport 与失败语义，`3.5` 只负责认证和 Mailpit 双邮件场景，均可用独立 Diff、单元测试和运行 Evidence 验证。
- 配置继续支持无认证或成对 username/password；Secret、token 与完整邮件正文不进入日志、审计或业务响应。Admin invitation 的显式发送失败与忘记密码的防枚举受理语义保持各自领域边界。
- Mailpit 仅是 loopback 本地验收依赖且没有业务数据 volume；生产发布和外部计费影响仍在范围外。

## 结论

`PASS`

下一路由：执行 Phase 3.4，统一 SMTP transport，再完成 Mailpit 双邮件验收。
