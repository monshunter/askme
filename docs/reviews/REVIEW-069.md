# REVIEW-069：SPEC-002 Repository Wiki 语义修订 Spec Review

## 审查对象

- Objective：`OBJ-009`
- Plan：[PLAN-014](../plans/PLAN-014.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Revision：`SPEC-002 sha256:9ac8b113ae568d77b569947f4fb8199ec09948fd693d0f2d5e3f0bf2928368e7`
- 审查日期：2026-08-13

## 用户结果与边界

- 核心产物已从 4–6 条离散 Claim 纠正为一份可直接阅读、编辑、预览和导出的 Repository Wiki Markdown；主价值是建立仓库心智模型，而不是展示局部代码事实卡片。
- Wiki 要解释项目定位、组件关系、模块地图、关键工作流、接口/数据/安全、构建运行、扩展维护和限制，并至少包含一张 Mermaid 图；章节允许随仓库结构调整，没有把所有项目强制套进固定模板。
- Repository 继续固定不可变 Revision、只读 Artifact、无源码 Chunk/embedding/AST/向量索引；实时深度问答仍是会话级结果，不回写 Wiki。
- rounds、模型输入上下文和单次输出默认值继续分别为 `50`、`1,000,000` 和 `200,000`，没有因报告形态变化退回旧预算。

## 完备性与可测试性

- 模型输出合同明确为 `title + summary + wikiMarkdown + citations + coverage`；正文 `[S*]` 标记与结构化 Citation 必须由 Host 一一验证，避免 Markdown 成为绕过源码证据校验的第二通道。
- Candidate 审核对象是整份 Markdown；Generated Version、Approved Projection、active Revision、运行 provenance 和 visibility 的 owner 仍然分离，新 Revision 未批准时保留旧 active 行为。
- 固定 `new-api` 验收增加了面向质量的硬边界：至少 8 个实质章节、1 张 Mermaid 图、跨主要子系统检查不少于 30 个代表性文件，并完成后续约 10 题问答基准。
- 旧 Claim-only Generated Version 不能被误当作 Wiki；设计与迁移必须使其退出当前 active 检索，同时保留可恢复数据并通过新 run 生成 Wiki。

## 风险

- 只把 Claim 卡片拼成一个 Markdown 字符串仍不满足本 Spec；产品 Skill 必须先做仓库结构盘点和子系统深挖，再组织报告。
- 直接把整份大 Wiki 送进每次普通问答会浪费上下文；实现应从 Approved Markdown 中确定性切分并选择相关 section，但不得为此重新持久化源码。
- Mermaid 与 Markdown 必须走现有安全渲染边界；不执行 HTML、脚本或仓库中的指令。

## 结论

`PASS`

下一路由：实质更新 [DESIGN-005](../architecture/DESIGN-005.md)，明确 Wiki 持久模型、Host 校验、Approved Markdown section 检索、旧 Claim-only 数据兼容和 Candidate UI，再执行 Design Review。
