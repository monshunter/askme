# REVIEW-070：DESIGN-005 Repository Wiki 设计修订 Review

## 审查对象

- Objective：`OBJ-009`
- Plan：[PLAN-014](../plans/PLAN-014.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- Revision：`DESIGN-005 sha256:83e2f33a475c6a33776631c4a86962573afa12429d38d9e9c1368cc13e0c5fa1`
- 审查日期：2026-08-13

## 边界与事实 owner

- Generated Wiki 的唯一正文 owner 是 `repository_dossiers.generated_markdown`，结构化源码 owner 是 `repository_wiki_citations`，Candidate 修改只进入 projection `edited_markdown`；没有同时维护 Claim 卡片和 Wiki 两套当前知识源。
- 旧 Claim-only 表只保留部署前数据，不再被新 run、检索或 UI 使用；迁移仅清空其 active pointer并标记 outdated，不删除行、artifact、用户资料或历史 Citation，符合保留数据部署与可恢复要求。
- Wiki section 检索在请求内从 Approved Markdown 确定性切分，不创建源码 Chunk、embedding、AST、向量索引，也不持久化第二份 Wiki section 索引。

## 生成、校验与安全

- 产品 Skill 先盘点仓库，再按主要子系统阅读实现、测试和运行入口；50 rounds / 40 tools 的上限继续由 Host 执行，固定 `new-api` 场景要求跨子系统至少 30 个 examined paths。
- 输出 `title + summary + wikiMarkdown + citations + coverage` 先经过 JSON/size/Markdown 结构校验，再验证 `[S*]` marker、manifest、path、line range、hash、SHA 与当前 visibility；microVM cleanup 成功前不持久化结果。
- Markdown 允许表格、代码标识和 Mermaid，但不执行 HTML、脚本或仓库指令；SSE 与 Admin safe projection 不传输 Wiki 正文、源码、prompt、tool output 或 reasoning。
- 通用仓库只要求至少 5 个实质 H2，固定 `new-api` 质量场景要求至少 8 个，避免用大型验收阈值错误拒绝小型仓库。

## 运行、迁移与回滚

- Revision、Wiki review 和 active pointer 保持独立；新 Wiki 失败或待审核不替换已有合格 active，Claim-only legacy active 则因不满足新合同而退出 current consumer。
- 回滚以关闭 Code Agent、停止 runner 和保留新表/artifact 为主，不使用宽范围删除；现有 PostgreSQL、upload volume、会话、消息、发布和账号继续保留。
- 普通问答只加载相关 Approved Wiki section，深度问题仍创建一次性 BoxLite microVM；权限撤销和历史 Citation 重投影不依赖生成时快照。

## 结论

`PASS`

下一路由：更新 [PLAN-014](../plans/PLAN-014.md) 的未完成 Phase 7，把 Wiki 合同迁移、生成、UI、检索、固定 public/private 场景和全站回归拆为可执行 Item，再重新 Plan Review。
