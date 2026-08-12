# Personal Agent Harness

本目录保存 AutoGo 安装到项目中的非 Skill Harness 资源。Skill 只进入所选原生 Agent 的标准发现目录；完整参考样例、清单和说明统一保存在项目 `.autogo/` 中。

## 关键边界

- 所选原生 Agent 是唯一控制面；
- Codex 的 `.agents/` 和 Claude Code 的 `.claude/` 根目录都只包含一个 `skills/` 目录，AutoGo 不向 Agent 原生目录加入其他结构；
- 不存在简洁/完整模式切换，安装后始终使用这一套完整能力；
- 不安装项目根 `./harness`，不要求用户执行 Work/Doc/Component CRUD；
- Skills 根据上下文自动维护必要的文档和进度；
- 每个 Skill 独立拥有自己的 `scripts/`、`references/` 或 `assets/`，不得依赖共享 `internal/` 辅助目录；
- `.autogo/` 不启用持久化备份模式；安装失败依靠事务回滚，项目本地改动默认保留并将候选内容写入 `.autogo/conflicts/`；
- 项目根全局唯一 `PROGRESS.md` 与标准 docs 子工作区 README/INDEX 一样在缺失时初始化；初始 Progress 依次包含使用规则、格式样例和空的 Objectives 区域，不使用表格或独立 Plans 章节，重复安装和 `--force` 不覆盖，安装器不生成 `WORKGRAPH.yaml` 或对应模板。

## 入口

- 工程治理：项目根 `AGENTS.md` 或 `CLAUDE.md` 的 Harness 托管区块；
- Codex Skills：`.agents/skills/autogo-<name>/`；
- Claude Code Skills：`.claude/skills/autogo-<name>/`；
- 全局变更循环：项目根 Agent 指令文件的 Fast / Standard、内层工程循环与精简 Standard Skill graph；
- Skill 发现与触发：只读取 frontmatter `name` 和 `description`；正文只在命中后加载并负责执行合同，根 graph 只维护固定门禁、能力分组和失败回流，不复制各 Skill 的细分触发条件；
- 真实 UI E2E：`autogo-e2e-run` 根据场景和显式工具约束选择当前 Agent 的浏览器或桌面 UI 控制能力；能力、权限、认证或环境不足时 fail closed，不自动安装插件；
- 完整参考样例：`.autogo/templates/`；
- 安装清单：`.autogo/manifests/`；
- Skill 内包资源：对应 Skill 目录内的 `scripts/`、`references/`、`examples/` 或 `assets/`。
