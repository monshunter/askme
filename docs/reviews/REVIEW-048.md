# REVIEW-048：PLAN-012 Plan Review

## 审查对象

- Objective：`OBJ-007`
- Plan：[PLAN-012](../plans/PLAN-012.md)
- 上游需求：Candidate/Admin 页眉精简、问答 Markdown、Candidate 来源查看与公开 Citation 授权访问
- Revision：`HEAD db21e35 + feat/markdown-source-preview Plan Diff`
- 审查日期：2026-08-12

## 范围与顺序

- Plan 先对账 `SPEC-001` 与 `DESIGN-001` 的行为、授权和安全边界，再实施共享内容体验与公开 Citation，最后执行自动化、浏览器验收和交付收口；公共访问不会先于权限合同落地。
- Candidate/Admin 页眉操作与领域页面内搜索被明确区分，移除范围不会误删 Knowledge 或 Admin 子页面的真实搜索能力。
- `citation_allowed` 继续允许公共回答使用来源但不提供文件地址，只有 `public_preview` 允许公开打开来源；Candidate owner 访问与匿名访问没有混为同一授权入口。
- Candidate 全部来源入口、公开 Citation 最小投影、Markdown/PDF 弹窗与其他格式新标签页均有独立 Item，没有把完整公共知识库、数据库枚举、部署或其他 owner 数据带入范围。

## 原子性与可验证性

- Phase 1 的行为合同、访问合同和独立审查分别可完成并勾选；长期事实复用现有 Spec/Design，不创建平行 owner。
- Phase 2 按 Shell、Chat 和 Candidate 来源入口拆分，Phase 3 按公开投影、服务端授权与文件格式体验拆分；每项都有可对应的静态、单元、API 或浏览器 Evidence。
- Phase 4 将自动化、真实浏览器和 Change Review/Close 分开，未把测试命令或执行日志写进 Plan。

## 结论

`PASS`

下一路由：进入 Phase 1，更新并审查 `SPEC-001` 与 `DESIGN-001`；审查通过后按 TDD 实施。
