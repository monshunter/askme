# PLAN-004：闭环 Platform Admin 与真实数据审计

## 目标

让 Platform Admin 使用完全由 PostgreSQL、运行健康与审计事实驱动的治理工作区，并系统对账当前所有用户页面和交互，确保产品路径不包含设计稿示例、静态假数据或 mock 成功。

## 范围

本 Plan 覆盖全仓用户可见数据/API 审计、Admin Overview、Candidates、Published Agents、Reports、Content Review、Settings、治理动作、审计、安全投影和 Admin 设计稿页面；English / 简体中文、最终跨页面键盘可访问性与整个 Objective 的 from-zero/restart/总验收由后续 Plan 继续交付。

## Phase 1：事实源与治理边界

关联 Spec：[SPEC-001](../specs/SPEC-001.md)

- [ ] 1.1 对账全部用户页面、可见数据和主要交互的数据/API owner，消除产品路径中的示例值、静态假数据和 mock 成功
- [ ] 1.2 明确 Admin 聚合、账号、发布、内容审查和平台设置的最小读写契约与私有原文禁区
- [ ] 1.3 补齐 Admin 持久状态、约束、兼容 migration 与可恢复边界

## Phase 2：Admin 领域与 API

- [ ] 2.1 实现 Overview 指标、最近发布、审查队列和时间范围趋势的真实聚合
- [ ] 2.2 实现 Candidate 搜索、状态查看、暂停与恢复及对应审计
- [ ] 2.3 实现 Published Agent 搜索、公共预览、治理暂停与恢复及对应审计
- [ ] 2.4 实现 Reports 时间范围聚合和真实空态
- [ ] 2.5 实现 Content Review 列表、review、resolve、dismiss 与安全摘要边界
- [ ] 2.6 实现 Settings 的 AI/数据库/worker 健康、非敏感运行配置、平台策略和邮件能力状态

## Phase 3：Platform Admin UI

- [ ] 3.1 交付 Admin 独立 Shell、导航、搜索、Quick Action、账号状态和移动导航
- [ ] 3.2 交付设计稿 Overview 的真实指标、最近发布、审查队列、趋势与 Quick Actions
- [ ] 3.3 交付 Candidates、Published Agents、Reports、Content Review 与 Settings 的真实筛选、分页、操作和空态
- [ ] 3.4 保证所有设计稿可见主要控件连接真实行为或明确显示不可用原因

## Phase 4：安全与验证

- [ ] 4.1 完成 Admin 角色、输入、并发状态、Candidate 私有原文隔离和审计元数据的自动化验证
- [ ] 4.2 完成 Docker Admin 聚合与治理状态机 smoke，并证明公共访问即时遵守暂停/恢复
- [ ] 4.3 完成 Chrome 1448 × 1086 与 390 × 844 的 Admin 主链路、视觉、响应式和 console 验收
- [ ] 4.4 完成 Change Review、Admin AC 对账、索引、Progress 与原子 Commit
