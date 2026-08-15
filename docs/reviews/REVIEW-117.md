# REVIEW-117：PLAN-025 成熟 Entity-grounded RAG Plan Review

被审制品：`PLAN-025`

Revision：`sha256:9da6563bdd0186747c004fc4ee8fcfe8dba57d2f2a759933bbc5a5b9c42b115f`

Verdict：`PASS`

## 审查结论

- Plan 聚焦一个可独立交付的用户结果：在现有 V2 基础上完成实体一致、可靠拒答、可信评测、可诊断和可重建的成熟 RAG 闭环，没有把代码仓库 Deep Analysis、生产发布或新的外部依赖混入范围。
- Phase 顺序从 Spec/Design、实体化知识与索引、查询和 Answerability、质量门禁、真实重建/E2E 到 Change Review/Close，依赖关系成立；第一条实现 Item 不会先于 Spec 与 Design Review。
- `RAG_NOTES.md` 的建议被定位为输入而非权威实现方案；Plan 明确复用 Askme 已有权限、索引版本、Rerank、Claim/Citation 和 Trace，不重复建设平行检索系统。
- 项目未上线且用户已允许清理或重建知识库，因此不需要旧派生索引兼容路径；Plan 仍把账号、原始材料、Repository、权限、Publication 与会话作为不可被派生重建误删的业务事实，破坏范围有边界。
- Phase 2 和 Phase 3 将实体 owner、查询保真、检索前硬约束、未知实体、局部可回答、会话指代与 Coverage 误判拆开，能够分别建立失败测试和完成验证。
- Phase 4 同时要求合成评测落到真实核心组件、真实 Provider/数据库链路以及常规工程门禁，避免继续把脚本内硬编码 outcome 当作系统质量 Evidence。
- Phase 5 分离环境重建、API 验收与浏览器验收；每项都有可观察结果，并覆盖权限、Citation、Trace、持久化和 UI 反馈。
- 各 Item 描述结果而非文件操作或实现日志；实现过程中若事实证明 Entity Catalog 需要新的持久 owner 或评测边界发生实质变化，应先更新 Design/Plan 并重新 Review。

下一路由：进入 Phase 1，使用 `autogo-spec-write` 更新 `SPEC-002`，完成 Spec Review 后再更新并审查 `DESIGN-005`。
