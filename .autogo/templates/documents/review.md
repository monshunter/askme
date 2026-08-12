# REVIEW-001：中文参考模板改造审查

> 这是 Review 样例。真实审查必须指向精确 revision，并把发现与当前代码或运行证据绑定。

## 审查对象

- 目标：`SPEC-001` 对应的模板内容与资源路径改动
- revision：工作区当前 diff
- 父 Plan：[PLAN-001](../plans/PLAN-001.md)
- 子 Spec：[SPEC-001](../specs/SPEC-001.md)

## 审查范围

检查模板语言、内容完整性、固定路径、Plan/Spec 可追溯关系，以及资源包和校验器是否仍引用旧渲染字段。

## 结论

有条件通过。模板正文方向符合目标，但在安装验收完成前不能宣布交付闭环。

## Spec/Design decision matrix

| Type | Boundary ID | Decision | Target | Reason |
|---|---|---|---|---|
| Spec | `harness-reference-documents` | `UPDATE` | [SPEC-001](../specs/SPEC-001.md) | 现有行为 owner 仍正确，本次扩展安装验收语义 |
| Design | `harness-reference-documents` | `REFERENCE` | [DESIGN-001](../architecture/DESIGN-001.md) | 现有资源组织和分发设计已完整支撑本次变更 |

四态只使用 `CREATE | UPDATE | REFERENCE | NOT_NEEDED`；`UPDATE` 为默认，只有新的独立边界才使用 `CREATE`。

## 发现

发现按已满足项和仍需修正项分组，避免把未验证内容混入通过结论。

### 已满足

- 所有文档样例使用中文标题和说明。
- 样例包含具体事实、取舍、失败处理和验证方式。
- Plan Review 与长期 Spec/Design 通过决策矩阵保持可追溯关系。

### 需要修正

- 若 `pack.json` 或测试仍引用 `.tmpl`，安装会失败。
- 若校验器继续搜索 Front Matter 字段，会把正确的新样例误报为缺失。

## 缺失证据

- 尚无从 `temp/` 执行的 Codex 与 Claude Code 黑盒安装结果。
- 尚无旧安装 Manifest 更新后的退休路径证据。

## 必需的后续行动

完成全仓旧路径搜索，更新摘要后运行严格校验和 acceptance。只有这些证据成立后，才能将结论更新为通过。
