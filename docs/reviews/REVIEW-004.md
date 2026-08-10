# REVIEW-004：DESIGN-001 Design Review（复审）

## 审查对象

- 制品：`DESIGN-001`
- Revision：`sha256:22a473c0f20091306f62a5a3fa3b3917d3b0a84f8fc8c18df4dc71a95f86db0e`
- 上层 Plan：`PLAN-001`
- 审查日期：2026-08-10

## 发现

初审两项阻塞均已消除：私有 connector Token 仅存在于已认证请求，远端内容先转为 owner 隔离且不含凭证的本地快照，worker 和重试只处理该快照；无消费者的 `SESSION_SECRET` 已删除。

复审确认：组件职责和依赖单向；PostgreSQL 是业务与 job 唯一事实源；owner 与 visibility 在检索前执行；Citation 不能引用候选集合外 Chunk；数据库、文件、worker、AI 和 connector 失败均有恢复路径；Docker 持久化与显式 reset 边界清楚。相较增加 Redis、对象存储、向量数据库或独立 API 服务，当前方案满足 `SPEC-001` 且复杂度更低。

## Evidence

- 被审设计：[DESIGN-001](../architecture/DESIGN-001.md)
- 行为合同：[SPEC-001](../specs/SPEC-001.md)
- 初审发现：[REVIEW-003](REVIEW-003.md)
- `rg` 确认 connector 快照职责存在且 `SESSION_SECRET` 已无残留，`git diff --check` 通过。

## 结论

`PASS`

下一路由：批准 `DESIGN-001`，执行 `PLAN-001` 的 3.1，使用 TDD 与 Implement 建立工程基础。
