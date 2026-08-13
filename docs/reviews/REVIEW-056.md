# REVIEW-056：DESIGN-005 幂等模型增量 Design Review

## 审查对象

- Objective：`OBJ-008`
- Plan：[PLAN-013](../plans/PLAN-013.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- 前次通过审查：[REVIEW-055](REVIEW-055.md)
- Revision：`DESIGN-005 sha256:85f6f7cbb82a30925547529d2dcaf77a22fef96709c923eaa15afe1d279ba8cc`
- 审查日期：2026-08-13

## 增量边界

本次只审查 sync、Repository Analysis 与 Conversation Analysis 的幂等键，以及它们与显式重跑、授权和 provenance 的关系；`REVIEW-055` 已通过的其他组件、安全、失败与成本边界保持不变。

## 一致性与并发

- sync key 绑定 owner、canonical repository、full SHA 与 filter fingerprint，不会把不同 owner 或过滤结果错误复用为同一授权记录。
- Repository Analysis key 包含 artifact/filter、image、Skill、prompt、Profile 和 generation；普通 lease/网络重试复用同一 generation，显式重跑递增 generation，因而同时满足“误重试去重”和“同 Revision 主动重分析”。
- Conversation Analysis 绑定 conversation、`clientMessageId`、revision 与 route/policy version，浏览器重连或重复提交不会重复创建 microVM，同时策略变化不会错误复用旧决策。
- Profile fingerprint 覆盖影响结果和成本的模型、thinking/reasoning、budget 与 compatibility；实际 model 另存 provenance，不把请求配置误当上游实际执行事实。
- 幂等命中仍重新执行当前授权检查，旧 completed/pending run 不能绕过 visibility、publication、取消或权限撤销。

## 复杂度

新增一个 `analysis_generation` 和三类确定性 fingerprint 已足以表达 approved rerun 与 retry；无需分布式锁、外部幂等服务或第二队列。唯一约束与现有 PostgreSQL lease 模型同源。

## 结论

`PASS`

下一路由：重新批准 `DESIGN-005`，保留 `REVIEW-055` Notes，并进入最终文档一致性与 Change Review。
