# PLAN-006：闭环本地运行、可观测性与总验收

## 目标

证明 Askme 能从空数据库安全启动、在非破坏性重启后保留完整产品状态，并让关键请求、后台任务、错误与治理审计可复核；最后在当前 revision 完成自动化、Docker 与 Chrome 总验收。

## 范围

本 Plan 覆盖隔离的 Docker from-zero/restart 生命周期、显式 reset 防护、请求与 job 追踪、结构化错误和审计安全、当前 revision 的完整质量门禁及 Objective 总收口；不清空当前 `askme-local` 数据，不声明生产部署就绪。

## Phase 1：运行与观测事实

关联 Spec：[SPEC-001](../specs/SPEC-001.md)

- [x] 1.1 对账 Compose、持久 volume、reset、错误码、请求/job 追踪与审计的当前实现和缺口
- [x] 1.2 明确不破坏当前环境的 from-zero、restart、数据保留与日志安全验收边界

## Phase 2：Docker 生命周期闭环

- [x] 2.1 实现隔离且具目标保护的 Docker 生命周期验证入口
- [x] 2.2 验证空数据库 migration/bootstrap/健康收敛、重启数据保留和 reset 显式门禁

## Phase 3：可观测性闭环

- [x] 3.1 补齐关键请求、后台 job、错误结果和治理操作的关联标识与安全结构化记录
- [x] 3.2 验证稳定错误码、请求/job 追踪、审计时间与结果可复核且不泄露 Secret 或完整私有原文

## Phase 4：当前 revision 总验收与收口

- [x] 4.1 完成单元、集成、构建、migration 与全部 Docker smoke 总门禁
- [x] 4.2 完成 Candidate、Interviewer、Admin 的桌面与 iPhone 14 Pro Max Chrome 总验收
- [x] 4.3 完成 Change Review、OPS/OBS/TEST AC、索引、Progress 与原子 Commit 对账
