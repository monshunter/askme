# REVIEW-095：DESIGN-001 邮件域名与游客多会话增量 Design Review

Verdict：`PASS`

- Objective：`OBJ-013`
- Plan：[PLAN-018](../plans/PLAN-018.md)
- Spec：[SPEC-001](../specs/SPEC-001.md) `sha256:6b84f6c09594ce6d6e132e733a2aa226d62b846774d93574778fc648cbe79a5e`
- Design：[DESIGN-001](../architecture/DESIGN-001.md)
- Revision：`DESIGN-001 sha256:ce7b13a0598f085d4689bbcbc8ec671b2f59dcdd4330cb6a41f7e3b8a7abe7af`

## 结论

设计以现有 Runtime Config、SMTP transport、Browser Visitor Identity、Conversation 与公开 Agent 壳层为基础，没有引入新的身份表、会话标题状态或并行 Chat 服务。邮件 URL 由一个 canonical public base URL helper 生成，能够消除请求 Host 注入且保留现有 SMTP 安全语义。

数据库从 `publication + visitor hash` 唯一关系演进为一对多，仅移除唯一索引并补充 list/switch 索引，不改写现有数据。singular bootstrap 与 plural management API 分工明确；所有内容访问继续用 `publication + visitor hash + conversation id` 授权。首条问题投影标题避免双重事实源，Deep 运行中拒绝删除避免无追踪的 microVM，逐会话过期、级联删除和应用回滚边界完整。

桌面复用现有左侧栏并增加会话卡片，窄屏保持单列内容顺序；loading、切换、最后会话删除和无横向溢出均有验证入口。方案满足 `AC-MAIL-001`、`AC-CHAT-005` 与 `AC-CHAT-006`，未发现更简单且同样保留安全边界的替代方案。下一路由是按 TDD 交付邮件公开域名。
