# 2026-08-12：OBJ-004 Candidate Agent 入口收敛

记录类型：delivery

路由：Standard

Objective：`OBJ-004` 收敛 Candidate Agent 导航与发布体验

Plan：[PLAN-009](../plans/PLAN-009.md)

Session Review：`NO_EVOLUTION`

## 本次实际完成

- 将 Candidate 的预览、settings、readiness、链接生成、发布、公开访问与撤销收敛到唯一 Agent / 智能体页面。
- 删除独立 Publish Agent 一级入口、专用页面、Candidate 公共预览 API 与 preview navigation helper；保留 Agent 页面继续使用的 publication 服务、API 和数据模型。
- 移除 Candidate Quick Action 与 Invite Interviewers，保留五个主要导航入口。
- 由根 Layout 唯一渲染登录前后共用的右上角语言切换，清除页面、footer 和账号菜单中的重复实例。
- 将 Askme 中文品牌统一为“职问”，同时保留英文名 Askme 和普通“询问候选人”语义。
- 更新产品 Spec、系统/UI Design、稳定 Scenario、自动化与索引，并完成 `PLAN-009` Change Review。

## 关键决定与 Diff 摘要

- publication domain 不是重复模块：只退役 Candidate 的独立页面和专用 UI，复用现有 API/服务承载 Agent 页内发布生命周期。
- locale cookie 与 `/api/preferences/locale` 不变；Root Layout 只改变控件 owner 和可见位置。
- 发布/撤销后的 refresh 同步更新 publication overview 与 Agent Public Mode，修复真实浏览器中发现的同页状态漂移。
- 当前 Diff 限于产品/设计合同、Scenario/Review/Journal、Candidate 与共享 UI、i18n、样式、发布 smoke 和定向回归；不修改数据库、权限、Secret、生产状态或外部依赖。

## 当前验证

- 最终 Change Review：[REVIEW-042](../reviews/REVIEW-042.md) `PASS_WITH_NOTES`；前序审查与专用预览后端 Reconcile 记录见 [REVIEW-041](../reviews/REVIEW-041.md)。
- 完整 Vitest：43 个文件、143 个测试通过；typecheck、lint、生产 build 与 `git diff --check` 通过。
- publication smoke 覆盖 readiness、链接生成、发布、撤销、旧链接失效、公开投影安全、Agent SSR 发布区域、唯一全局语言入口与旧 publish 页面/API 404，全部通过。
- [SCN-001](../scenarios/SCN-001.md) 在桌面 `1448 × 1086` 与移动 `430 × 932` 完成全局语言、Candidate 导航、发布生命周期、公开页、品牌、几何、overflow、旧路由与 console 验收；fixture 和临时 Web 已清理。

## 偏离计划与恢复

- 用户在初始 Agent 合并范围后补充了全局语言位置和“职问”品牌要求；两次都更新 Plan/Spec/Design 并重新通过对应 Review，没有绕过合同 owner。
- Docker BuildKit 的镜像内构建无输出停留超过 6 分钟后停止；同 revision 宿主机生产构建、临时 production server 健康检查、smoke 与浏览器验收通过。本次不报告 Docker 镜像重建 PASS，`PLAN-009` 也不包含部署。
- Session Review 为 `NO_EVOLUTION`：浏览器发现的产品缺陷已 Reconcile 到实现和测试 owner；一次 BuildKit 环境现象不足以新增 Harness 演进。
- 若提交前检查失败，从 `fix/candidate-agent-navigation` 分支读取本 Journal、`PLAN-009`、`REVIEW-041` 与当前 Git Diff，修复对应 owner 后重跑验证和 Change Review。

## 预期 Commit subject

`fix: consolidate Agent navigation and global language controls`

Journal 不回填 Commit hash；实际关联由 `git log -- docs/journal/2026-08-12-plan-009-candidate-agent.md` 查询。
