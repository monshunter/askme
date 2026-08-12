# REVIEW-041：PLAN-009 Change Review（初审）

## 审查对象

- 制品：`PLAN-009`、根产品规格、`SPEC-001`、`DESIGN-001`、`DESIGN-003`、Candidate Agent 合并实现与 `SCN-001`
- Revision：`HEAD 7ce39ec + PLAN-009 working tree`
- 上层 Objective：`OBJ-004`
- 审查日期：2026-08-12

## 范围与正确性

- Candidate Shell 的一级导航只保留 Dashboard、Upload Materials、Knowledge Base、Privacy Control、Agent；Quick Action、Invite Interviewers 与独立 Publish Agent 入口及专用页面已移除。
- `/workspace/agent` 同时加载预览对话、settings 与 publication overview；原发布组件的 readiness、链接生成、发布、公开访问和撤销行为已迁入 Agent 页面，共享 publication API、服务与数据模型保持不变。
- 发布或撤销后的 `/api/publications/current` refresh 同时更新发布区域与 Agent settings 的 Public Mode，避免同一页面显示相互矛盾的状态。
- 根 Layout 是业务源代码中唯一的 `LanguageSwitcher` owner；登录、Candidate、Public Agent 与 Admin 的页面、footer 和账号菜单不再渲染局部实例，cookie/API 行为没有变化。
- 英文 Agent 标签与标题精确为 `Agent`，中文精确为“智能体”；所有渲染 TSX 品牌标记使用“职问”，普通语义“询问候选人”不属于品牌替换范围。
- 旧 `/workspace/publish` 与 `/workspace/publish/preview` 页面、专用 `PublishClient`、`GET /api/publications/preview`、仅由该 API 使用的 service function 和 preview navigation helper 已删除；Platform Admin 发布治理、公共 Agent API 和 Agent 页面仍使用的 publication 服务/API 保留。

## 合同与兼容对账

- 最终 Plan Review `REVIEW-038` 的矩阵与 Diff 一致：根产品规格、`SPEC-001`、`DESIGN-001` 与 `DESIGN-003` 均为 `UPDATE`；各 Target 的 Boundary ID、owner 和 active 状态一致。
- 根产品与 UI 合同明确唯一 Agent 入口、全局唯一语言入口和 Askme / 职问品牌；验收项只在完整自动化与 `SCN-001` 当前 Evidence 成立后标记完成。
- 改动不触及数据库结构、publication 数据语义、公开问答权限、locale cookie/API、Secret、生产状态或外部依赖；回滚为代码和文档撤销，不需要数据恢复。

## 验证

- `npm test`：43 个文件、143 个测试通过；包含 Candidate workspace、全局语言 owner、品牌残留与双语精确命名回归。
- `npm run typecheck`、`npm run lint`、`npm run build` 与 `git diff --check`：PASS；生产构建路由中只有 `/workspace/agent`，无独立 publish 页面。
- `npm run smoke:publication`：发布 readiness、链接生成、发布、撤销、旧链接失效、Agent SSR 发布区域、旧页面/API 404 与登录/Agent/公共页唯一全局语言入口均通过。
- `SCN-001`：桌面和移动端完成登录前语言切换、Candidate 导航、隐私确认、发布、公开访问、撤销、中文“智能体”、全局控件几何、无横向 overflow 与旧路由 404；console error/warning 为 0，fixture 与临时 Web 已清理。
- bundled delivery trace 回归通过；修正最终 Plan Review 的 Design 决策和 Phase Item 的 Scenario 链接后，`PLAN-009` strict trace 为 `0 errors, 0 warnings`。

## 发现

没有发现会影响目标、正确性、兼容、安全、可访问性、恢复或范围的缺陷。

## 结论

`PASS_WITH_NOTES`

当前 Diff、合同、自动化和真实用户场景满足 `PLAN-009`。可以进入 Session Review、Journal 与关闭检查。

Note：Docker BuildKit 在镜像内的同一 `next build` 阶段无输出停留超过 6 分钟后被停止；同 revision 的宿主机生产构建、`next start -p 3100` 健康检查、publication smoke 与浏览器验收均通过。本次未把 Docker 镜像重建报告为 PASS，也没有把该环境现象误判为产品失败；`PLAN-009` 不包含部署或镜像发布。

## 后续 Reconcile

提交前 source audit 发现只由已退役公共预览页面使用的 `GET /api/publications/preview` 及 service function 仍存在，和用户允许移除相关专用后端的范围不完全一致。实现已删除该 API/function，更新自动化与合同并重新完成构建、运行 smoke；最终审查见 [REVIEW-042](REVIEW-042.md)。
