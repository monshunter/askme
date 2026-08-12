# REVIEW-049：SPEC-001 Markdown 与来源访问增量 Review

## 审查对象

- Objective：`OBJ-007`
- Plan：[PLAN-012](../plans/PLAN-012.md)
- Spec：[SPEC-001](../specs/SPEC-001.md)
- Revision：`feat/markdown-source-preview` 当前 Spec Diff
- 审查日期：2026-08-12

## 一致性与边界

- 页眉移除范围明确限定为 Candidate/Admin Shell；Knowledge、Candidates、Published Agents 与其他领域页面搜索不受影响，通知、身份、语言和移动导航继续存在。
- Candidate 预览与公开 Agent 的用户问题、Agent 回答都进入安全 Markdown 合同，支持的语法和禁止执行的 raw HTML、脚本、危险 URL 可独立验证。
- Citation 的名称展示与文件访问被拆为两个权限结果：`citation_allowed` 只显示来源名称且没有地址，`public_preview` 才能打开来源；这与用户补充的公开边界一致。
- Candidate owner 可从 Dashboard、Materials、Knowledge、Privacy 与 Agent Citation 的全部来源名称打开自己的资料；公开访客不会获得完整知识库浏览能力。
- Markdown/PDF 当前页居中预览、PDF 默认 A4 比例与其他格式新标签页的格式矩阵明确，未把浏览器查看扩大为内部路径暴露。

## 可测试性

- `AC-MAT-005` 可由多入口 Candidate 浏览器场景和 owner/cross-owner API 证明。
- `AC-PRIV-003` 可用 `citation_allowed/public_preview` 对照、publication 撤销、visibility 撤销与跨 owner 请求证明。
- `AC-AGENT-005`、`AC-CHAT-004` 可用 Markdown 结构、危险 HTML、Citation 响应字段和真实 dialog 几何证明。
- `AC-UI-007` 可通过 Shell 合同测试、桌面/移动 DOM 与领域搜索仍可用的浏览器证据证明。

## 结论

`PASS`

下一路由：按更新后的长期合同审查 `DESIGN-001` / `DESIGN-003`，通过后进入 TDD 与实现。
