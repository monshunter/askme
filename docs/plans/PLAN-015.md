# PLAN-015：统一 Approved Repository Wiki 的知识浏览与问答证据

## 目标

让 Candidate 能在职业知识库中浏览、搜索和识别当前 Approved Repository Wiki，并证明 Candidate Preview 与授权 Public Chat 能在后续问答中使用同一 Wiki 及其不可变源码 Citation。

## 范围

本 Plan 覆盖职业知识库产品合同、统一只读投影、Repository Wiki 详情、搜索筛选、Candidate/Public 问答证据、权限边界、测试与真实浏览器验收；不把 Wiki 复制为 `knowledge_items`，不公开 pending/generated/disabled/private Wiki，不允许知识库编辑动作修改 Generated Wiki 或源码 Citation，也不把实时 Deep Analysis 结果回写长期知识。

## Phase 1：明确统一知识语义

- [x] 1.1 更新 Approved Repository Wiki 在职业知识库中的浏览、搜索、详情和权限合同
- [x] 1.2 更新统一知识只读投影与既有 Repository/Material owner 边界设计
- [x] 1.3 完成 Spec 与 Design Review

相关合同：[SPEC-002](../specs/SPEC-002.md)、[DESIGN-005](../architecture/DESIGN-005.md)

## Phase 2：交付统一知识浏览

- [x] 2.1 用失败测试固定 Approved Wiki 的列表、计数、搜索、筛选与未批准隔离行为
- [x] 2.2 实现 Knowledge Item 与 Approved Wiki 的统一分页读模型
- [x] 2.3 实现 Repository Wiki 的知识库详情与只读交互
- [x] 2.4 完成定向类型、单元与 PostgreSQL 集成验证

## Phase 3：证明后续问答可用

- [x] 3.1 验证 Candidate Preview 只检索当前授权的 Approved Wiki
- [x] 3.2 验证 Public Chat 按 publication 与 Repository visibility 使用 Wiki 并投影 Citation
- [x] 3.3 完成知识库与 Agent 问答真实浏览器场景

## Phase 4：对账并关闭交付

- [x] 4.1 完成全量相关门禁与 Change Review
- [x] 4.2 对账 Spec、Design、Plan、Progress、运行 Evidence 与 Git
- [x] 4.3 创建原子 Commit 并关闭 Objective
