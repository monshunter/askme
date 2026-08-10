# PLAN-001：建立可验收产品合同与全栈基础

## 目标

把根 `SPEC.md`、`asserts/images/` 与用户补充约束转化为可逐项验证的产品合同和系统方案，并交付可通过 Docker 运行的真实全栈基础纵切片。

## 范围

本 Plan 包含 MVP 验收契约、系统设计、Web 与 PostgreSQL 工程基础、身份与权限边界、DeepSeek 配置入口，以及基础运行验证；具体 Candidate、Interviewer 与 Platform Admin 业务闭环由后续 Plan 按本合同继续交付。

## Phase 1：产品验收合同

关联 Spec：[SPEC-001](../specs/SPEC-001.md)

- [x] 1.1 将产品规范、设计稿页面与补充约束整理为含稳定 AC 的正式 Spec
- [x] 1.2 审查正式 Spec 的一致性、完备性与可测试性

## Phase 2：系统方案

- [x] 2.1 定义组件、数据、权限、AI 检索生成、失败恢复与本地部署方案
- [x] 2.2 审查系统方案对正式 Spec 和风险边界的覆盖

## Phase 3：全栈基础纵切片

- [x] 3.1 建立 Web、数据库、测试和本地容器化工程基础
- [x] 3.2 闭环身份会话、角色授权、运行配置与 DeepSeek 可用性检查
- [x] 3.3 通过自动化测试和 Docker 运行验证基础纵切片

## Phase 4：Review 与收口

- [x] 4.1 完成当前 Diff、测试、配置、安全和范围的 Change Review
- [x] 4.2 对账 Plan、Progress、文档索引与原子 Commit
