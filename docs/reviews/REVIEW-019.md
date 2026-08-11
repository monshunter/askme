# REVIEW-019：PLAN-004 Change Review（精确视口 Reconcile 后终审）

## 审查对象

- 制品：`PLAN-004` 当前完整工作树
- Revision：`HEAD c2a3be2 + feat/askme-mvp-full-loop working tree（提交前）`
- 上层 Objective：`OBJ-001`
- 审查日期：2026-08-11

## 审查范围

- Admin migration、领域服务、Route Handler、UI、公共策略 consumer、SMTP capability 与安全投影。
- `AC-ADMIN-001`–`003`、`PLAN-004` 全部 Phase Items，以及 `REVIEW-016` 的精确视口 blocker。
- 生产 Docker 构建、真实 PostgreSQL smoke、Chrome 1448 × 1086 与 DevTools iPhone 14 Pro Max 430 × 932。

## 新鲜 Evidence

- `npm run lint`、`npm run typecheck`、`git diff --check` PASS；37 test files / 125 tests PASS。
- 修复 CSS 资源路径后 Docker production build PASS，Web 容器使用新镜像重建；`/api/health/ready` 返回 database、migration、worker `ready`，AI `configured`。
- 当前源码的 `smoke:admin` 从具有 bootstrap 配置的一次性 migrate 容器访问 `web:3000` 后 PASS：角色边界、真实聚合、安全投影、Candidate session 撤销、Candidate/Agent 公共传播、Review 状态机、策略持久化、七类审计和 SMTP 未配置显式失败全部成立。
- smoke 后 PostgreSQL 中 `@local.invalid` fixture user 与 `admin-smoke-*` audit 计数均为 `0`。
- Chrome 1448 × 1086 实测 document/body `scrollWidth=1448`、无横向溢出，warning/error 日志为 `[]`。
- 可见 DevTools `iPhone 14 Pro Max` 实测 `innerWidth=430`、`innerHeight=932`、`devicePixelRatio=3`；Overview 与 Settings document/body `scrollWidth=430`、无横向溢出。移动抽屉、Candidates、Published Agents、Reports、Content Review、Settings 和治理确认对话框均可达。
- 浏览器首次发现的 Askme `/frontend_bg_left.png` 404 已修复并在新生产容器复验消失；可见 DevTools 剩余错误全部来自已安装 Chrome 扩展，不包含 Askme URL、资源、React 或脚本错误。

## 发现

- `REVIEW-016` 唯一 blocker 已由精确桌面与移动视口 Evidence 消除；Spec、Design、Plan 和 Operation 对移动基线的表述一致。
- Admin SSR、API 与公共入口继续共享 PostgreSQL domain owner；账号/publication 当前状态在公共访问时逐请求检查，暂停与恢复没有缓存窗口。
- Admin 查询与审计未投影 Material storage path、Chunk/Message 原文、密码/token hash 或 Secret；Content Review 和搜索只使用治理字段、公开 Agent identity 与 `safe_summary`。
- 所有设计稿可见 Admin 数据、趋势、筛选、分页和操作来自 API/数据库或明确 capability state；没有示例姓名、伪指标、静态曲线或 mock success。
- 两处横向水墨背景改用现有相对资源导入后由 Next.js 打包，不改变资产语义，也不新增重复二进制文件。

未发现影响 `AC-ADMIN-001`–`003`、数据完整性、权限、安全投影、响应式或 Docker 交付的缺陷。

## Notes

- 本地默认没有 SMTP 配置，因此真实邮件发送未运行；产品已验证明确不可用、无伪成功和 token hash 契约，该外部 capability 不阻塞默认本地闭环。
- 用户 Chrome 的三个扩展错误不由 Askme 产生；Chrome 插件在同一产品页面捕获的 warning/error 日志为空。

## 结论

`PASS_WITH_NOTES`

Notes 不影响目标、安全、验收或恢复。下一路由：`autogo-change-close`，完成 Admin AC、索引、Progress 与原子 Commit 对账；随后为同一 Objective 的下一未完成范围建立正式 Plan。
