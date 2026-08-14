# REVIEW-100：PLAN-019 公开身份补全与 Agent 发布可达性 Change Review

Verdict：`PASS`

- Objective：`OBJ-014`
- Plan：[PLAN-019](../plans/PLAN-019.md) `sha256:0a607a5e05bd06bc86d45e6374bbe78a7de078186424280a552f2cea3c3d36ce`
- Spec：[SPEC-001](../specs/SPEC-001.md) `sha256:bf5754503d5606f376fa3fe8d6d5a76fd50413366c548c484c685d40fbabc762`
- Design：[DESIGN-001](../architecture/DESIGN-001.md) `sha256:609977668f7b428ed9cf1a2e474c7409d9bc8cb4bc43a77116b9e1d2ccdaabbf`
- 审查日期：2026-08-14

## 根因与修复正确性

- 普通注册事务只写 `display_name`，publication policy 却固定要求 `display_name + headline`；项目没有 Candidate 公开资料写入边界，公开身份“去处理”还硬编码到无编辑动作的 Dashboard。因此这是所有缺少 headline 的新老 Candidate 都可触发的恢复死路，不是目标账号缺少特殊发布权限。
- `POST /api/auth/profile` 只接受已认证 Candidate，输入 schema 剥离 owner/role 等越权字段，只按 session user id 与 `role='candidate' AND status='active'` 更新现有公开资料列，并在同一事务写不含资料正文的审计。
- 账号页新增真实公开资料表单；发布 readiness 的公开身份阻塞项直达 `public-profile`，只接受 allowlist 返回目标，保存后重新请求 Agent 页并从数据库重算 readiness。发布仍要求真实职业头衔，没有以默认值或降低门槛掩盖问题。
- Dashboard“面试官对话未解锁”继续只表示 Agent 尚未发布；本次没有制造新的前置状态或循环依赖。

## 权限、兼容与恢复

- 自助注册、bootstrap、邀请或历史 Candidate 共享相同 role/session 能力，不需要 migration、单账号 grant 或数据回填；已有完整身份账号行为保持不变。
- 地点与简介可为空，显示名称和职业头衔有长度与非空约束；客户端不能修改邮箱、密码、role、status 或其他 owner。
- 更新已发布 Candidate 的 profile 会立即投影到公共页面，但职业头衔不能被清空；应用回滚不涉及 schema 或破坏性数据恢复。
- Surface Matrix 已登记 `/api/auth/profile POST`，`smoke:auth` 拥有服务端运行 Evidence；`smoke:publication` 已从旧 cookie 恢复对齐到当前 localStorage token 请求头合同。

## 当前 Evidence

- 定向 TDD：4 files / 18 tests PASS，覆盖输入规范化、owner/role 剥离、active Candidate SQL 边界、审计、内部返回目标、开放重定向拒绝和 UI 直达合同。
- 全量门禁：Vitest `87 files / 296 tests`、ESLint、Next typegen + TypeScript、production build、`git diff --check` 全部 PASS；Surface Matrix 为 `22 pages / 67 API routes / 74 methods / 27 verification entrypoints`。
- 保留数据部署后 db/Web/Mailpit healthy、worker running、ready 全绿；`smoke:auth` 与 `smoke:publication` PASS，临时账号、邀请与发布 fixture 均已清理。
- “星空的鱼”真实浏览器从阻塞状态直达资料编辑，保存“AI Agent 应用开发工程师”后 readiness 全绿并成功发布；公共页正确显示名称与职业头衔，访问/撤销入口可见，console warning/error 为 0。
- 新注册真实浏览器账号完成同一身份补全路径；公开身份转为 ready，其余资料/隐私项继续正确阻塞。`430 × 932` 截图确认公开资料表单单列可操作。
- 最终数据库为 `users=3 / conversations=29 / messages=142`，临时 E2E/auth/publication 用户为 0；目标账号为 `published + public_mode=true`。

## 结论

实现、权限、合同、验证入口、运行环境与目标用户结果一致，未发现阻止关闭的问题。下一路由：进入 `autogo-change-close` 对账 Plan、Progress 与 Git 并创建原子 Commit。
