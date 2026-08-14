# REVIEW-096：PLAN-018 邮件域名与公开多会话 Change Review

Verdict：`PASS`

- Objective：`OBJ-013`
- Plan：[PLAN-018](../plans/PLAN-018.md) `sha256:ccf93b1f1287a841f80f0a3d553bc966e11f689e914c12117a4b857be0b2c455`
- Spec：[SPEC-001](../specs/SPEC-001.md) `sha256:7444a1d7eb45d68883a069d038a136c4c03fd1ed24d610a820a4c41cdb05f041`
- Design：[DESIGN-001](../architecture/DESIGN-001.md) `sha256:ce7b13a0598f085d4689bbcbc8ec671b2f59dcdd4330cb6a41f7e3b8a7abe7af`
- 审查日期：2026-08-14

## 正确性与合同一致性

- `ASKME_PUBLIC_BASE_URL` 只接受无凭证、query、fragment 和业务 path 的绝对 HTTP(S) 根 URL，默认规范化为 `https://askme.monshunter.xyz/`；密码重置与 Admin invitation 通过同一个 server-only helper 生成链接，不再读取请求 Host。
- `0020_public_conversation_sessions.sql` 只移除 `publication + visitor hash` 唯一索引并增加会话列表索引，不改写或删除既有 Conversation、Message 与业务 volume。singular session bootstrap 恢复最近会话，plural sessions API 独立负责列表、新建与精确删除。
- Chat、suggestion、feedback、analysis SSE、material 和 repository source 全部重新校验 `publication + visitor token hash + conversationId`；另一个游客或另一个 publication 即使获得 Conversation、Message、Run 或 Source 标识也不能访问或修改。
- 会话标题由首条用户问题投影，不新增可漂移的持久标题。删除只级联目标 Conversation，Deep `pending/running` 时返回 `PUBLIC_SESSION_BUSY`；删除最后一个当前会话后，浏览器自动创建空会话恢复可用状态。
- 公开页保留 Candidate 身份卡和分享入口，在左侧加入双语会话列表、新建、切换、删除确认、loading/error 状态与键盘焦点约束；窄屏重排为单列且不依赖隐藏桌面操作。

## 安全、兼容与恢复

- 现有 visitor bearer、HttpOnly transport cookie、30 天逐会话过期与限流语义保持不变；本次没有扩大 Candidate、Admin 或公开资料权限。
- 应用回滚不依赖恢复唯一索引；新版本产生多个会话后强行恢复旧唯一索引会失败，因此数据库回退应保留 `0020` 并回滚应用代码，符合 Design 中的恢复边界。
- 审查中补齐了 `smoke-agent-runtime-acceptance` 的显式 Conversation 参数和 surface matrix 的两个新 API owner，避免旧验证入口与新公共契约漂移。

## 当前 Evidence

- Vitest `85 files / 290 tests`、ESLint、Next typegen + TypeScript、production build、`git diff --check` 全部 PASS。
- Surface matrix PASS：`22 pages / 66 API routes / 73 methods / 27 verification entrypoints`。
- 配置与公开 URL 定向测试、忘记密码 Route 测试、公开 Chat input/Citation 与客户端 session contract 共 `6 files / 22 tests` PASS。
- Migration 已在当前本地数据库应用，schema version 为 `0020_public_conversation_sessions.sql`；既有数据量保持 `29 conversations / 142 messages`，唯一索引已替换为 `conversations_public_visitor_sessions_idx`。
- Compose 网络内扩展 `smoke:public-chat` PASS，覆盖同一游客新建两个会话、独立内容与首问标题、最近活动排序、切换、删除、删除后 404、剩余会话不受影响及跨游客精确拒绝。
- Compose 网络内 `smoke:auth` 在运行 Web 和 Mailpit 上观察两类真实邮件，并断言密码重置与 Admin invitation 均使用 `https://askme.monshunter.xyz/`；request origin 为 `http://web:3000`，没有改变邮件公开域名。
- 保留数据部署前后均为 `29 conversations / 142 messages / 3 users`，最终 `auth_smoke_users=0`、`smtp_smoke_invitations=0`、`running_analysis=0`；db/Mailpit/Web healthy，worker 与全部 ready capability 正常。
- 真实浏览器在 `1280 × 720` 与 `430 × 932` 完成新建、首问标题、独立回答、切换、刷新恢复、删除确认与删除后续接；两种 viewport 均无横向 overflow，中英文入口可见，console warning/error 为 0。

## 结论

实现、合同、迁移、安全边界、运行环境与用户验收一致，未发现阻止关闭的问题。下一路由：进入 `autogo-change-close`，对账 Plan、Progress 与 Git 并创建原子 Commit。
