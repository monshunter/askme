# REVIEW-066：PLAN-014 Phase 7 非破坏性全站回归增量 Change Review

## 审查对象

- Objective：`OBJ-009`
- Plan：[PLAN-014 Phase 7](../plans/PLAN-014.md)
- Spec：[SPEC-001](../specs/SPEC-001.md)、[SPEC-002](../specs/SPEC-002.md)
- Scenario：[SCN-001](../scenarios/SCN-001.md)、[SCN-002](../scenarios/SCN-002.md)
- 审查日期：2026-08-13

## Findings

非破坏性实现与隔离全栈回归范围内无剩余 correctness、安全、兼容、运行或 scope finding。

审查前的执行循环发现并已 Reconcile：

1. expired 且已请求取消的 Analysis Run 曾被 scheduler 永久排除；现在该 run 可被重领，先清理 stale microVM，再进入 cancelled terminal，且不会新建 microVM。
2. 匿名 API surface 探测发现 malformed 或 schema-invalid 登录 JSON 被通用异常处理投影为 500；现在分别稳定返回 `INVALID_JSON` 与 `INVALID_CREDENTIALS_INPUT` 400，表单登录与角色跳转保持不变。
3. Agent smoke 仍断言历史 `Agent Preview`，Public Chat smoke 仍断言公开 Citation 暴露 `chunkId`；两项均已对账到 `SPEC-001` 的 `Agent / 智能体` 单一入口和当前 Public Citation 最小投影。
4. Repository Retention fixture 缺少当前 schema 必填的 `configured_model`，且失败清理没有移除无 owner artifact；现在快照字段完整，并在 `finally` 按 5 个确定性 content key 精确清理。
5. 首次 standalone 浏览器启动只复制 server bundle，客户端无法 hydration；确认是临时运行目录缺少 `.next/static` 与 `public`，补齐 production standalone 资产后重新开始浏览器 Evidence，未把 SSR-only 结果计为 PASS。

## 正确性、安全与范围

- `scripts/verify-surface-matrix.ts` 与真实文件系统一致：18 个页面、59 个 Route Handler、65 个 method、25 个 package 入口、3 个角色、2 个 viewport；新增或删除 surface 会使 verifier fail closed。
- `smoke:api-surface` 对全部 65 个声明 method 验证非 405/501、request id、内容类型与非预期 5xx，并为每个路径验证一个未声明 method 返回 405；领域 smoke 补充角色、输入、owner、幂等、重试和撤权语义。
- scratch PostgreSQL 从空库应用 16 个 migration；真实 Web、worker、host runner、Artifact Store 与 BoxLite 同时 ready。应用 AI fixture 只验证兼容协议和状态机，不被记录为外部模型质量 Evidence。
- 真实浏览器逐页覆盖 anonymous、Candidate、Public、Admin 的桌面与移动 surface；Candidate → publication → Public → revoke 和 Admin 审核状态机均使用当前 API/数据库，console error/warning 为 0，页面无横向 overflow。
- Admin 页面未出现 runtime-state 私有 marker、源码、问题、回答、Prompt 或工具输出；Public Citation 只暴露来源名和当前授权访问能力。visibility/publication 撤销在新请求与旧 URL 上即时生效。
- 本次 scratch database、browser/admin fixture、Web/worker/runner 与 AI fixture 已精确清理；临时目录移入废纸篓。当前 `askme` 数据库、Compose 服务和 volumes 未被迁移、删除或重启。

## Evidence

- `npm run verify:surface-matrix`：PASS，`18 / 59 / 65 / 25`。
- `npm test`：PASS，62 个文件 / 210 个测试。
- `npm run lint`、`npm run typecheck`、`npm run build`、`git diff --check`：PASS；production build 24 个页面，零 warning。
- 24/25 package 验证入口：PASS；`verify:docker-lifecycle` 因主数据库破坏性 migration Human Gate 保持 `BLOCKED`。
- 全组件 readiness：database、migration、worker、runner、artifact、boxlite、ai 均 `ready`，Code Agent capability 为 `ready`。
- Browser：18 页面 × 2 viewport，无横向 overflow，console error/warning 为 0；Markdown raw script 未执行，PDF 比例 `0.707077`，clipboard 为当前公开 URL，撤销后旧 slug 不可用。

## 未完成门禁

- 主数据库唯一旧 GitHub material 及其纯旧来源派生数据的删除与保留数据部署仍需用户明确批准；`verify:docker-lifecycle` 随部署执行。
- 固定 public Revision 的约 10 题真实上游模型质量基准需要 `ASKME_AI_API_KEY`。
- 固定 private Revision 的一次性 Token、撤权和泄露扫描需要 `ASKME_GITHUB_TEST_TOKEN`。

## 结论

`PASS_WITH_NOTES`

Notes 是 Phase 7.4、7.5、7.9、7.11、7.12 的真实 Human Gate / credential 条件，阻止 PLAN-014 与 Objective 完成，但不否定 Phase 7.1、7.2、7.3、7.6、7.7、7.8、7.10 的当前 Evidence。下一路由：保持 Waiting，用户批准精确删除并在 `~/.env` 配置两个键后，从保留数据部署与固定 public/private Revision 验收继续。
