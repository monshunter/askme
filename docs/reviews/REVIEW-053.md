# REVIEW-053：SPEC-002 Spec Review

## 审查对象

- Objective：`OBJ-008`
- Plan：[PLAN-013](../plans/PLAN-013.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Revision：`SPEC-002 sha256:10d5c8d7fdcdbd3c027a8091aaa33aa50da19d5a597b7889f4ca44f2dbdcfa60`
- 审查日期：2026-08-13

## 一致性与 owner

- `SPEC-002` 只定向替代 `SPEC-001` 的 GitHub Source Material、源码 Chunk/RAG 和 DeepSeek 专用配置边界；既有文档资料、Knowledge Item、发布、公共 Chat 与 Admin 产品行为仍由 `SPEC-001` 拥有，没有把历史已完成 AC 改写为当前实现事实。
- Repository、Revision、Artifact、Dossier、Generated Version、Approved Projection、Deep Analysis Run 与源码 Citation 均有独立定义，且 Repository 不再与 Material 共用 kind、同步状态或派生知识 owner。
- 持久 Dossier 与会话深度结论的 owner 分离：前者必须经过 Candidate 审核，后者只保存为会话消息，不回写 Dossier、Knowledge Item 或 RAG，未形成自我强化的第二知识源。

## 行为、异常与权限

- `private` 明确只保存经过校验的 artifact，不启动 Agent；提升到可分析 visibility 后才进入 Dossier 流程，消除了“所有 Revision 强制分析”与“private 不允许 Agent”的冲突。
- 新 Revision 失败不替换旧 active Revision，Dossier draft 不进入公共回答，Generated Version 与 Approved Projection 分离，运行版本变化只产生 `analysis_outdated`，正常更新、失败与治理禁用有不同语义。
- 确定性门禁位于 Router 之前；Router 不拥有授权。多仓库歧义、证据不足、拒绝、run 失败和取消均有外部可区分结果，不允许用伪造 RAG fallback 掩盖失败。
- 四级 visibility 同时约束 Candidate/Public Agent 与 Citation 投影；历史公共消息每次按当前权限重投影，`citation_allowed` 不泄露 commit、path、lines、snippet 或地址。
- 临时 GitHub Token、AI key、Repository 指令文件、Pi 产品 Skill 与 sandbox 生命周期边界清楚，且没有把 Admin 确定性治理重新包装成 System Operations Agent。

## 可测试性与范围

- 18 条 AC 使用唯一稳定 ID，覆盖同步、过滤、Dossier、路由、run、SSE、权限、AI Profile、成本、历史记录和固定 public/private 仓库验收。
- 公共与私有验收均固定完整 SHA；私有 Token 读取顺序、一次性传递和禁止静默跟随 `main` 可由脚本与泄露扫描验证。
- V1 非目标明确排除多 provider Git、跨仓库、代码写入、执行、向量索引、计费和 warm sandbox，未为未批准未来需求扩大合同。

## Notes

- 资源表、API path、数据库字段与具体事件 payload 属于 Solution Design，不需要进入产品 Spec。
- 所有新 AC 保持未勾选；当前文档审查 PASS 不能替代后续实现 Evidence。

## 结论

`PASS`

下一路由：批准 `SPEC-002` 内容并进入 Solution Design；不得将本 Review 解释为功能已经实现。
