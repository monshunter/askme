# REVIEW-109：PLAN-021 Agent 回答质量 Change Review

Verdict：`PASS_WITH_NOTES`

- Objective：`OBJ-016`
- Plan：[PLAN-021](../plans/PLAN-021.md) `sha256:ce9bbe2d46b95edae109a17ea5925ce3a37e18ad46631979d008dd75a5a4ae62`
- Spec：[SPEC-002](../specs/SPEC-002.md) `sha256:391fc9f98f5423f2e30f9ec59edb864ccb1ab1e07715b5d1e89bce968eea8820`
- Design：[DESIGN-005](../architecture/DESIGN-005.md) `sha256:d13aaca2371e47578dcdac4125e771d255b7ce13807a2a5b42e1611d55a454e3`
- 审查日期：2026-08-14

## 审查范围

审查普通 RAG 回答中的 Host 当前日期、问题方面提取、Provider 输出约束、Verifier 后覆盖对账、重复 Claim 处理、Candidate Preview/Public Chat 接入、质量评估、Docker 保留数据重部署和真实浏览器结果。Evidence 授权、Citation 投影、索引数据语义、Deep Analysis 与 Provider 选择不在变更范围；无关未跟踪文件 `NOTES.md` 不进入本次 Diff 或 Commit。

## Findings

没有阻断或需要继续修复的 correctness、安全、兼容、数据或范围发现。

审查过程中发现并已 Reconcile 的问题：

1. Provider 在单方面问题中使用语义标签代替 Host `aspectId`，导致真实 Public 回答失败；现仅在唯一 Host aspect 时安全归一，多个方面仍拒绝未知 ID。
2. 初始跨方面高重叠规则会误拒绝职责与成果共享的必要公司上下文；现仅跨方面拒绝规范化完全重复，同方面继续合并或拒绝无法安全合并的高重叠 Claim。
3. 真实模型质量评测曾只复述“自 2017 年起”而未给出年限；现由 Host 从已验证 Claim 的职业起点和冻结日期派生约 9 年或精确年月，并覆盖 Provider 旧年份输出。

## 正确性、权限与兼容结论

- Candidate Preview 和 Public Chat 两个普通 RAG producer 都在请求内冻结一次 `currentDate`，并传入同一 retrieval plan 的 `answerAspects`；其他调用仅为定向测试和离线质量评估。
- Answer Generator 只能返回 Host 已声明方面和已提供 Evidence ID；Claim Verifier 仍逐 Claim 使用最小 Evidence subset，Citation Validator、owner、visibility、active version 和 checksum 校验保持不变。
- Host 在 Verifier 后重新计算方面覆盖、按原问题顺序渲染章节并显示 Evidence 缺口；相同 Claim 不会跨方面重复发布，同方面可安全包含关系只保留信息更完整的一条。
- 工作年限派生只使用已验证 Claim 中带起点语义的日期；无法识别起点时回退原已验证 Claim，不直接读取或猜测未验证职业事实。
- 变更没有 Migration、持久数据语义、Secret、权限、公开发布或不可逆运行状态变化；历史消息与 Citation 无需迁移。

## 当前 Evidence

- 工程门禁：`git diff --check`、ESLint、Next typegen + TypeScript、production build PASS；Vitest `100 files / 355 tests` PASS。
- 质量门禁：deterministic RAG V2 `120 cases` 全部 PASS，Recall/Citation/outcome 指标为 `1`、幻觉/泄露指标为 `0`、`failures=[]`；真实模型回答质量 `2 cases` PASS。
- Runtime：保留 `askme_local_pgdata` 与 uploads volume 重部署；部署前后均为 `4 users / 4 materials / 35 conversations / 184 messages / 100 rag_source_versions`。Web 使用新镜像、`restart=0`，live/ready 及全部 capability checks 为 ready/configured，近十分钟 Web/worker 错误日志为空。
- Browser：Candidate 复合问题和 Public 复合问题均按公司、时间、职责、成果四个方面顺序显示；Public 工作年限可见回答为“自2017年起，截至2026年，约9年相关工作经验。”，含 1 个公开 Citation、不含 2025 年，页面 console warn/error 为空。
- 清理：本轮 6 组临时 E2E 问答及其精确审计记录已事务删除，依赖由 FK 级联清理；两个原会话保留，最终消息总数恢复为 184。

## Notes

- 授权材料本身包含“2025.09 至今（已离职）”的时间状态矛盾。真实复合回答忠实呈现该 Evidence，Host 没有擅自选择或改写职业事实；若要消除该矛盾，需要 Candidate 修订并重新索引源材料。
- 本 Review 不把本地验收外推为生产发布或生产容量结论。

## 结论

Spec、Design、Plan、实现、测试、真实模型评估、运行环境、浏览器结果和 Git 范围一致。本次 note 不影响年份正确、显式方面完整、语义去重、权限或恢复目标；`PLAN-021 4.3` 可以进入 `autogo-change-close` 对账、关闭与原子提交。
