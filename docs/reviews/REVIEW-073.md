# REVIEW-073：DESIGN-005 Sandbox Wiki Copy-out 与统一知识检索 Review

## 审查对象

- Objective：`OBJ-009`
- Plan：[PLAN-014](../plans/PLAN-014.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- Revision：`DESIGN-005 sha256:fb0adea4da8ee8a41fa25aa0a86b8cc8ae943ba00eb9e19fb92e0c0cb88b4083`
- 审查日期：2026-08-14

## 组件与事实 owner

- `repository_dossiers` 拥有 Wiki manifest 与生成 provenance，`repository_wiki_pages` 拥有不可变 Generated Markdown，`repository_wiki_citations` 拥有 marker 到 Revision source range 的绑定，`repository_wiki_projection_pages` 只拥有 Candidate 编辑后的 Markdown。
- Pi 的 `write_wiki` 只能写 `/workspace/output/wiki`；Host 使用 BoxLite 0.9.7 原生 `copyOut`，随后 fail-closed 遍历普通 UTF-8 `.md` 文件。源码、输出、Host 临时目录和最终数据库之间没有共享可写挂载。
- Claim-only 表只保留历史数据；新 run、UI 和检索均只读 Wiki 表，避免双重当前知识源。

## 校验、修正与失败恢复

- Host 校验页面清单、路径、大小、危险 HTML、bundle 内相对链接、H1/H2、Mermaid、限制章节、marker 使用、源码 path/range/hash、coverage 与 visibility；不同页面可以用不同 marker 复用同一源码范围，符合正常 Wiki 写作。
- 工具结果暴露剩余预算但不暴露系统 Secret；80 tools 有硬上限，最后 10 次明确停止探索并收口。第一次 Host 校验失败只记录安全错误码并允许一次有界修正，仍失败则清理 microVM 和 Host 临时目录且不持久化 Wiki。
- 新 Wiki 待审核或失败时 active revision/projection 不变；只有批准事务同时验证当前 Revision、页面、Citation 和权限后切换，回滚不依赖删除新表或 volume。

## 统一知识检索

- `UnifiedEvidenceProvider` 合并文档 Chunk 与 Approved Wiki section；Wiki 在请求内按 H2 切分，只返回正文实际引用 marker 的 Citation，不复制 Wiki 为 Chunk，也不把源码放入全文索引。
- Candidate Preview 与 Public Chat 复用 answer generator、最终权限复核和 Citation 持久化；Material 按 chunk id 复核，Wiki 按 active projection、page id、marker 和 source hash 复核。

## 结论

`PASS`

下一路由：继续执行 [PLAN-014](../plans/PLAN-014.md) 的 Wiki 持久化、UI、检索、真实生成和部署验证 Item。
