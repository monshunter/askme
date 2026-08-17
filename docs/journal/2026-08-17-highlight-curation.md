# 2026-08-17：候选人亮点精选（Featured Highlights）与预览页管理面板

记录类型：delivery

## 目标与范围

公开 Agent 页（`/a/[slug]` 右侧栏）的「候选人亮点」此前完全自动：按 `confidence DESC` 取前 5 条满足资格（`status='active'` + 证据材料 `indexed` 且 `visibility='public_preview'`）的知识项。候选人在 Agent 预览页（`/workspace/agent`）看不到这些亮点，也无法控制哪些出现在公开页。

本次实现完整版精选能力：预览页新增「公开亮点」管理面板，支持「换一批」翻看候选池（每批 5 条，循环翻页）并逐一精选/移除；选择持久化到 `knowledge_items.featured_at`；公开页**仅展示精选项**（不做自动补位），按选择顺序，上限 5。

范围：仅涉及知识项精选链路与预览页 UI；不改公开页客户端、`PublicProjection` 结构、来源权限模型（`visibility-policy.ts` 不动）、admin、`publish.preview.*` 死键。

## 背景事实

- 知识项由 LLM 组织流水线生成（`organizer.ts`），`highlights` 为 AI 要点，候选人在知识点页可手改。
- 知识项在材料重新索引时**被重建**（`persist-ingestion.ts` 删除旧项、插入新 UUID 行）→ 精选状态需尽力保留。
- 预览页无亮点是 workspace 整合时刻意移除的（`publish.preview.*` i18n 键已成死代码），本次不清理。

## 本次实际完成

- **迁移** `migrations/0023_featured_knowledge_highlights.sql`：`knowledge_items.featured_at timestamptz`（可空）+ 部分索引 `(owner_id, featured_at) WHERE featured_at IS NOT NULL`；`schema.ts` 镜像 + `schema.test.ts` 断言。
- **新服务** `src/server/publication/highlight-curation.ts`：
  - `loadHighlightCuration(ownerId, page)`：已精选（按 `featured_at ASC`，带 `eligible` 布尔）+ 候选池（`confidence DESC` 排序、OFFSET 分页、截取 3 条高亮）+ 计数分页。
  - `saveFeaturedHighlights`：事务内全量替换（≤5 条）；所有 id 必须 owned + active + 有 `public_preview` 证据，否则 `HIGHLIGHT_NOT_ELIGIBLE` 400；`featured_at = Date.now()+index` 保证选择顺序；审计 `agent.highlights.save`（outcome `featured`/`unfeatured`）；不触碰 `updated_at`。
  - `parseHighlightSelection`：UUID 校验、去重、≤5（`INVALID_HIGHLIGHTS` 400）。
- **公开查询** `public-agent-service.ts`：亮点 WHERE 加 `featured_at IS NOT NULL`，ORDER BY 改 `featured_at ASC, id ASC`；保留 EXISTS 资格子查询（防御可见性降级）；未精选时展示现有空态。
- **API** `src/app/api/agent/highlights/route.ts`：GET（分页池）+ PUT（保存）。
- **重建保留** `persist-ingestion.ts`：删除旧知识项前捕获 (type,title,featured_at)，新项按 (type,title) 精确匹配回写原时间戳（尽力而为，用过即删）。
- **SSR** `/workspace/agent` 并行加载 `initialHighlights` 传入客户端。
- **UI** `agent-preview-client.tsx`：`agent-highlights-panel`（已精选列表可移除 + 失效警告；候选池批可精选，满 5 禁用；「换一批」循环翻页）；`globals.css` 配套样式（1120px/680px 断点）。
- **i18n** 16 个 `agent.highlights.*` 键（en + zh，`Record<TranslationKey, string>` 编译期强制对齐）。
- **测试**：新 `highlight-curation.test.ts`（7 用例：池分页、SQL 断言、事务顺序、错误码、审计 featured/unfeatured）；契约测试新增断言；`smoke-publication.ts` 种子 `featured_at` + 投影端到端（精选→显示、清空→隐藏、恢复→再显示）；`smoke-agent-preview.ts` 种子可见性改 `public_preview` + 精选 API 断言 + 审计计数 7→9。

## 验证

- 全量 Vitest `108 files / 449 tests`、ESLint、tsc 全绿；`db:migrate` 应用 0023。
- 真实 API（本地 dev + pg18）：精选→公开投影含该知识项；清空→投影隐藏；恢复→再显示。SSR 渲染「Public Highlights」面板；2 条 `agent.highlights.save` 审计行。
- **既有失败（与本次无关，stash 隔离验证过）**：`smoke-agent-preview` 的 grounding 引文断言（AI 回答 `INSUFFICIENT_EVIDENCE`，与 2026-08-17 RAG overview-fallback 进行中工作相关）；`smoke-publication` 匿名页 language-switcher 计数断言。两个冒烟在我新增断言之后的既有检查处失败，本次新增断言均通过。

## 恢复方式

- 代码层可直接回退本次 Commit；行为变更点：公开亮点查询（`public-agent-service.ts`）、`highlight-curation.ts`、预览页面板。
- 若需恢复自动排序展示：去掉公开查询的 `featured_at IS NOT NULL` 条件并改回 `confidence` 排序即可（数据层 `featured_at` 列可保留）。

## 预期 Commit subject

`feat: curate candidate highlights from the Agent preview`
