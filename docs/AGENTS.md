<!-- AGENT-HARNESS:BEGIN DOCS-CONTRACT -->
# docs 作用域 Agent 契约

本目录保存持久、可审阅、可版本控制的项目知识。安装器会创建完整标准工作区骨架；Agent 按真实工作创建具体制品，不预造任务内容。

## 规则

1. 标准 docs 子工作区及其 `README.md`、`INDEX.md` 由安装器在缺失时初始化；已有内容归项目所有，重复安装不得覆盖。新增非标准工作区必须源于真实领域边界，并由 Agent 根据项目事实直接创建。
2. `README.md` 说明目的、允许制品、命名、生命周期、负责 Skill 和归档规则；`INDEX.md` 只做动态索引，不重复正文。
3. 文档优先通过稳定文件名、一级标题、正文链接和表格表达关系，不要求统一 Front Matter；active Spec/Design 必须声明稳定 `Boundary ID`、`Owner boundary` 和 `Status`，其他小项目文档不为形式化而形式化。
4. Spec、Design、ADR、Plan、Review、Bug、Scenario、Operation、Journal、Evolution 各自保持职责边界；Plan 只拥有本次决策和变更，不拥有长期 Spec/Design；Scenario 定义可复用真实场景，Operation/Review 保存当前 revision Evidence，Journal 只保存交付恢复摘要。
5. Review 文档默认只记录发现和结论，不在审查过程中隐式修改被审对象。
6. 过期 Spec/Design 标记 `superseded` 并链接 active 替代 owner，不无痕删除历史决策；无稳定身份的旧文档只在首次被 Plan 使用时以 `UPDATE` 收编，不批量迁移。
7. 索引由 Agent 自动更新；可以直接编辑，也可调用 `autogo-doc-index` 及其内包脚本。不得要求用户手工维护。
8. 大体积日志、截图、录像和二进制制品不直接放入 docs；文档只保存引用和摘要。
9. 文档结论必须区分事实、假设、建议和 Evidence。
10. 当前组件存在更具体 `AGENTS.md` 时，相关文档同时遵守其领域规则。
11. 根 `PROGRESS.md` 只追踪 Objective 三态和内嵌 Plans Checklist。正式 Plan 是按 Phase 组织的单文件 Checklist；Phase 是小目标，Item 是原子任务，这些下层任务不写入 Progress。
12. Plan 与 Checklist 不拆分。需要引用 Spec/Design 时只在对应 Phase 保留简短链接；Plan 不保存实现过程、验证记录或额外状态。Item 实际完成后才可打勾。Standard 的正式 Plan 新建或实质调整后必须在第一条 Item 前通过 Plan Review。
13. Review 必须绑定被审制品 ID 和 revision，使用 `PASS`、`PASS_WITH_NOTES`、`FAIL`、`BLOCKED`。Review PASS 只表示制品可进入下一阶段，不替代交付验收，也不直接勾选 Progress 中的 Plan；`FAIL` 返回对应 owner Reconcile、修复、验证并重新 Review。
14. 每个 Standard Plan Review 按 `Type | Boundary ID | Decision | Target | Reason` 记录 Spec/Design 的 `CREATE | UPDATE | REFERENCE | NOT_NEEDED` 决策矩阵；`UPDATE` 为默认，同类型每个 Boundary 最多一个 active owner。真实浏览器、跨组件 smoke、from-zero/restart 或部署后 E2E 的 Plan Item 在运行前链接 `SCN-*`。
15. Fast 与 Standard 都在 Commit 前由 `autogo-work-journal` 写入带路由的 `delivery`；Fast 不依赖 Objective、Plan 或 Session Review，Standard 先完成四态 Session Review 并写入 `NO_EVOLUTION` 或 `EVO-*`；Waiting / Cancelled 分别使用 `handoff` / `cancel`。
<!-- AGENT-HARNESS:END DOCS-CONTRACT -->
