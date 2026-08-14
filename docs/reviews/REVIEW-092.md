# REVIEW-092：PLAN-017 认证、SMTP、游客隔离与 Citation 修复 Change Review

## 审查对象

- Objective：`OBJ-012`
- Plan：[PLAN-017](../plans/PLAN-017.md) `sha256:6694b99bdb1ff19effacfb5f729e5fa8210dbf5ed1dc110986dc214dbdcbe42e`
- Spec：[SPEC-001](../specs/SPEC-001.md) `sha256:71ec72c5c918aec2d57db5cab24a164936f20e124751569f9437aee5c8da67c7`、[SPEC-002](../specs/SPEC-002.md) `sha256:1f88de6d27a0eaa3d05a26d1cdae20c0c465d39ad623295ab92a7aaac0b7f36e`
- Design：[DESIGN-001](../architecture/DESIGN-001.md) `sha256:0ec7e79b5c0996e2b8bf24fb5596ab50db0087b5354db44489cc131e0f30820b`、[DESIGN-005](../architecture/DESIGN-005.md) `sha256:71f2eb7b63d13920a9e43b9f3b707e3d00bb2e134f9610b3b3e43bc9a4879c32`
- 审查日期：2026-08-14

## 正确性与合同一致性

- RAG marker parser 只把 canonical `S7` 和单层正文形式 `[S7]` 规范化为同一值，规范化后重复、未知 marker 和其他拼写仍 fail closed。函数/方法实现意图只有在唯一已授权且允许 Deep 的 Repository 上覆盖 Router，普通 Wiki 问题、多 Repository 歧义和权限门禁保持不变。
- Candidate 注册只能写入 `candidate`；忘记密码统一受理且只为 active Candidate 创建 30 分钟 token hash；reset 锁定并一次消费 token、更新 password hash、撤销全部 session；登录后改密重新锁定并复核当前密码，撤销旧 session 后签发当前请求的新 session。
- 密码重置和 Admin invitation 只保留领域模板，连接、可选成对认证、TLS、超时、transport 关闭和 Provider 错误收敛由 `server/mail` 统一负责。未配置能力在账号查询前失败；单封密码重置投递失败失效本次 token 并保留防枚举反馈。
- 浏览器身份由 `askme.publicVisitor.v1` localStorage bearer 拥有；header 优先于全局 transport cookie，session 初始化缺少 header 时不会从全局 cookie 恢复已清除身份，旧 slug cookie 只桥接一次。所有 chat、suggestion、feedback、run、material 和 repository source 入口重新解析 visitor 并绑定当前 publication Conversation。
- 同一 visitor token 在不同 publication 下使用独立 Conversation；另一个 token 无法读取消息或修改反馈。过期 Conversation 只封存旧 visitor hash并为该 publication 新建 Conversation，不旋转整个浏览器 token，因此不会使其他 Agent 的有效会话失联。

## 安全、兼容与恢复

- `0019_auth_and_visitor_identity.sql` 只新增 reset token hash 和认证限流表；现有用户、session、publication、Conversation 和上传 volume 不回填、不删除。认证限流 scope、reset token、visitor token 只持久化 SHA-256，密码继续使用现有 `scrypt`。
- 公共 bearer token 被复制即复制游客身份，这是显式客户端边界；服务端不把它升级为 Candidate、跨 publication 共享 Conversation 或写入日志/审计。global HttpOnly cookie 只支持 EventSource、来源页和新标签 transport。
- SMTP Secret 只来自 server runtime 配置；Mailpit 仅 loopback 暴露 UI/API、SMTP 只在 Compose 网络，且没有业务数据 volume。生产 SMTP provider、域名和公开发布不在本 Plan。
- Review 首轮发现过期 Conversation 会旋转全局浏览器 token，已改为封存旧 Conversation hash并以原 token 新建；又发现密码重置与 Admin invitation 各自维护 Nodemailer transport，已统一到单一 owner。两项均补测试和真实 smoke 后复审通过。

## 当前 Evidence

- 自动门禁：Vitest `84 files / 286 tests`、ESLint、Next typegen + TypeScript、production build、surface `22 pages / 64 API routes / 70 methods / 27 verification entrypoints`、Compose config 与 `git diff --check` PASS。
- Compose 网络内 `smoke:auth`：注册 201、忘记密码 200、reset 200、token replay 410、reset 后旧 session 401、改密 200、改密后旧 session 401；Mailpit 同时观察密码重置和 Admin invitation，invitation API 201/sent。测试用户与 invitation 清理为 0。
- `smoke:public-chat`：多轮、Citation、幂等、同身份恢复、跨 publication 独立、清除身份轮换、跨游客隔离、过期 Conversation 续建、反馈 owner、限流、权限重投影与撤销全部 PASS。
- `smoke:agent-runtime-acceptance`：固定 copybook 项目概览保持精确 RAG；`paginate` 固定问题的 Candidate/Public run 均 `completed/cleaned`，引用 `src/lib/pagination.ts` 和测试范围，route audit 为 source inspection Deep，问答不消耗日次数。
- 真实浏览器：Candidate 注册、改密、注销、忘记密码、Mailpit reset link、重置后登录闭环；同一浏览器跨刷新/标签恢复公开会话；430 × 932 最终 copybook 答案可见并显示 `src/lib/pagination.ts:22-24` 与测试 Citation，无横向 overflow，console warning/error 为 0。
- 最终环境：db/Mailpit/Web healthy，worker/runner/artifact/boxlite/provenance ready，AI configured；running run、测试账号、测试 invitation 和残留 microVM 均为 0。

## Notes

- 真实 Code Agent Provider 曾返回一次 Citation hash 不匹配，Host 正确拒绝，Runner 使用剩余预算重新读取后 correction 成功；另一次 Runner 进程退出由 expired lease + stale microVM 清理后重领完成。外部模型仍可能在一次 correction 后显式失败，但不会持久化无效 Citation 或伪装成成功回答；当前固定 Candidate、Public 和浏览器链路均已成功。

## 结论

`PASS_WITH_NOTES`

Notes 不影响目标、安全、验收或恢复；下一路由：进入 `autogo-change-close`，对账 Plan、Progress 与 Git 并创建原子 Commit。
