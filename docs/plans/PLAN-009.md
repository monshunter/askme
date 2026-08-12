# PLAN-009：收敛 Candidate Agent 入口与发布体验

## 目标

将 Candidate Workspace 的 Agent 预览与发布能力收敛为唯一的 Agent / 智能体入口，移除快捷操作、邀请面试和独立发布模块，把语言切换收敛为登录前后所有页面共用的右上角全局设置，并将 Askme 中文名统一为“职问”，保持发布、撤销与公开访问主流程可用。

## 范围

本 Plan 覆盖产品中文品牌名、根布局的全局语言入口、Candidate Workspace 导航、Agent 页面、发布页面及其专用前后端、双语文案、相关自动化与真实浏览器验收；不改变英文名 Askme、locale cookie/API、Platform Admin 的已发布 Agent 治理、公共 Agent 问答权限、发布数据语义或数据库结构。

## Phase 1：对齐长期产品合同

相关合同：[根产品规格](../../SPEC.md)、[SPEC-001](../specs/SPEC-001.md)、[DESIGN-001](../architecture/DESIGN-001.md)、[DESIGN-003](../architecture/DESIGN-003.md)

- [x] 1.1 使 Candidate Workspace 的唯一入口、命名和发布行为在产品合同中可验收
- [x] 1.2 使 Candidate Shell、Agent 页面与发布边界在系统设计中保持单一职责
- [x] 1.3 使全站唯一右上角语言设置在产品合同与 UI 设计中可验收
- [x] 1.4 使 Askme 中文名“职问”在产品合同与 UI 设计中成为唯一品牌名称

## Phase 2：收敛 Candidate 交互与实现

- [x] 2.1 建立入口命名、重复控件和退役路由的定向回归保护
- [x] 2.2 移除 Candidate Shell 中重复或不必要的语言、快捷、邀请和发布入口
- [x] 2.3 将发布生命周期管理收敛到 Agent 页面并退役独立发布模块（[SCN-001](../scenarios/SCN-001.md)）
- [x] 2.4 将语言切换提升到根布局并移除登录、Candidate、Public 与 Admin 的页面级入口
- [x] 2.5 将登录、Candidate、Public、Admin 与邀请页面中的旧“问候”品牌标记统一为“职问”

## Phase 3：验证与交付收口

- [x] 3.1 对账并更新受影响的自动化与稳定浏览器场景（[SCN-001](../scenarios/SCN-001.md)）
- [x] 3.2 完成定向测试、静态构建与真实 Candidate Agent 主流程验收
- [x] 3.3 完成 Change Review、Session Review、Journal 与提交前关闭检查
