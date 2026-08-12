# PLAN-012：交付 Markdown 问答与授权来源预览

## 目标

移除 Candidate 与 Platform Admin 页眉中的搜索和快捷操作，使 Candidate 预览与公开 Agent 问答安全渲染 Markdown，并让 Candidate 或公开访客按当前授权直接查看来源文件。

## 范围

本 Plan 覆盖 Candidate/Admin Shell、Candidate 与公开 Agent Chat、四级来源可见性合同、Candidate 全部来源文件名入口、公开 Citation 投影、owner 与公开访问接口、Markdown/PDF 居中预览、其他格式新标签页访问、双语与响应式体验；不开放完整公共知识库，不改变 Admin 领域页面内搜索、数据库枚举、Secret、部署或其他 Candidate 的数据。

## Phase 1：对齐行为与系统合同

相关合同：[SPEC-001](../specs/SPEC-001.md)、[DESIGN-001](../architecture/DESIGN-001.md)、[DESIGN-003](../architecture/DESIGN-003.md)

- [x] 1.1 明确页眉简化、问答 Markdown 和来源访问的可验收行为
- [x] 1.2 明确 owner 访问、公开文件授权、即时撤销与安全响应边界
- [x] 1.3 完成更新后 Spec 与 Design 的独立审查

## Phase 2：交付 Candidate 与共享内容体验

- [x] 2.1 移除 Candidate 与 Platform Admin 页眉搜索和快捷操作并保持其余导航可用
- [x] 2.2 使 Candidate 预览与公开 Agent 的问题和回答安全渲染 Markdown
- [x] 2.3 使 Candidate 工作区全部来源文件名按格式打开授权内容

## Phase 3：交付公开 Citation 来源访问

- [x] 3.1 使公开 Citation 只投影来源名称与当前访问能力
- [x] 3.2 使公开来源访问严格服从 `public_preview`、publication 与 owner 边界
- [x] 3.3 交付 Markdown/PDF 居中预览、其他格式新标签页和 PDF A4 默认布局

## Phase 4：验证与交付收口

- [x] 4.1 完成页眉、Markdown、来源投影与权限撤销的自动化回归
- [x] 4.2 完成 Candidate、公开 Agent 的真实桌面与移动浏览器验收
- [x] 4.3 完成 Change Review、Plan/Progress 对账与原子提交
