# REVIEW-044：PLAN-010 Change Review

## 审查对象

- Objective：`OBJ-005`
- Plan：[PLAN-010](../plans/PLAN-010.md)
- Revision：`HEAD e3a11da + opt/harness-simplified-install-sync working tree`
- 范围：Askme 中由 AutoGo 当前资源投影的根合同、Skills、模板、manifest、docs 托管区块，以及迁移残留清理和当前交付制品
- 审查日期：2026-08-12

## 正确性与兼容边界

- 当前 42 个 `managed_files` 全部存在，并与 AutoGo 当前 zh-CN 资源经过 `{{AGENT_DIR}}` / `{{INSTRUCTIONS_FILE}}` 渲染后的内容一致；根 `AGENTS.md` 在项目概述之后与当前根合同一致，Askme 项目事实继续保留。
- `docs/AGENTS.md#DOCS-CONTRACT` 与 `docs/README.md#DOCS-README` 均与当前渲染资源一致；区块外项目内容未被覆盖。
- manifest 已收敛为 schema 3 的路径所有权模型，包含 42 个管理文件和 2 个托管区块，不再保存内容 hash、catalog digest 或 Harness version。
- Harness 自检 Skill、`validate_harness.py` 与 delivery trace 主脚本已退休。初审发现 Askme 本地回归 `test_validate_delivery_trace.py` 仍导入已删除脚本；该残留 consumer 已一并删除，活跃项目范围内不再存在对应调用。
- 根合同、Change/Plan/Spec/Design/Journal/Session Review 等 Skills 与参考模板一致取消固定 Boundary matrix、Session Review、Journal、Scenario 和 delivery trace 门禁，但保留 Standard 的 Objective、Plan、Plan Review、Change Review、Evidence、Reconcile、Human Gate 与原子关闭主干。
- Diff 不修改 Askme 产品代码、依赖、数据库、权限、Secret、运行环境或部署状态；无需产品 E2E 或部署后验证。

## 当前 Evidence

- AutoGo 当前源 `go test -count=1 ./internal/resources ./internal/install ./internal/cli`：PASS。
- AutoGo 当前源 `make acceptance`：PASS；覆盖 24 个 Skills、3 个 Python 脚本、schema 3、资源退休、整文件/托管区块覆盖、project seed 保护、二次安装、双 Agent、dry-run 与失败路径。
- Askme 投影对账：42 个管理文件 0 missing、0 mismatch；2 个 docs 托管区块全部匹配。
- Askme 结构检查：24 个 Skill frontmatter 与目录名一致；3 个剩余 Python 脚本编译通过；退休目录、主脚本和残留测试均不存在。
- Plans/Reviews Index 重建幂等，指令解析链为根 `AGENTS.md` 与 `docs/AGENTS.md`；`git diff --check` PASS。

## 发现与处置

初审发现的残留 delivery trace 测试会在被测脚本删除后直接失败，属于迁移 consumer 漏清理。已返回实现 owner 删除该测试，并通过活跃范围搜索和安装验收确认不再残留；没有其他影响正确性、兼容、安全、恢复或授权范围的问题。

## Notes

- Askme 当前根合同包含 AutoGo 工作树中尚未提交的“系统思维最小应用”增量；本 Review 以当前源文件、当前 Diff 和实际测试为 Evidence，不把其描述为已有来源 Commit。
- schema 3 明确把根 `AGENTS.md` 作为 AutoGo 完整管理文件；后续重装会覆盖 Askme 已填充的项目概述以及工具可能追加的根级内容，需要再按当前项目事实初始化。这是当前安装合同的已知语义，不影响本次投影正确性。

## 结论

`PASS_WITH_NOTES`

Notes 不影响当前目标、安全、验收或恢复。可以继续用户明确要求的 Journal、Plan/Progress 对账与原子 Commit。
