# PLAN-027：修复 Repository Analysis Runner 生命周期并恢复公开仓库分析

## 目标

修复本地 Compose 正常但 host-native Code Agent Runner 缺失时 Repository Analysis 永久停留在 `pending` 的问题，让本地运行入口、Runner 配置与 readiness 保持一致，并恢复 `monshunter/goat`、`monshunter/ferry` 两个已同步公开仓库的分析与可审核 Wiki。

## 范围

本 Plan 复用现有不可变 Revision、Artifact、Analysis Run 租约、BoxLite 隔离和 Candidate Wiki 审核边界；覆盖宿主 Runner 生命周期、项目与用户环境配置优先级、仓库分析默认预算、默认并发、故障诊断、保留数据恢复、自动化及 API/数据库运行验收。不改变 GitHub 同步协议、Repository 权限、Wiki 审核语义、AI Provider、Secret、持久数据结构或生产环境；仅按用户授权删除 Ferry 的五条重复或诊断失败 Analysis Run 及级联事件，不删除现有 Repository、Revision、Artifact、Dossier、账号及其他业务数据。用户已明确排除本次 UI/E2E 验收。

## Phase 1：固化故障模型与最小运行方案

- [x] 1.1 对账两个公开仓库的 Revision、Analysis Run、Runner heartbeat 与 readiness 根因
- [x] 1.2 在现有 host-native BoxLite 边界内明确 Runner 启停、配置、观测和恢复合同

## Phase 2：交付可验证的生命周期修复

- [x] 2.1 用失败测试固定本地启动、环境优先级和 `nohup` 后台进程行为
- [x] 2.2 实现最小跨平台 Runner 后台入口并保持 Compose 与宿主配置一致
- [x] 2.3 在根 README 补全整套环境启动、Compose-only、手工恢复、日志和 readiness 命令
- [x] 2.4 用失败测试将默认硬边界调整为仓库分析 30 分钟、100 个模型轮次和 300 次工具调用，并同步配置入口
- [x] 2.5 用失败测试将 Runner 默认全局并发调整为 3，并验证有效配置
- [x] 2.6 用失败测试为 Repository Analysis 增加轮次与工具调用双重收敛门槛，保留 Wiki 写出与纠错预算
- [x] 2.7 重建 Code Agent 镜像，清理 Ferry 重复失败任务并恢复唯一 run，确保租约、终态、失败反馈和 microVM 清理收敛

## Phase 3：完成工程与真实环境验收

- [x] 3.1 通过定向测试、全量测试、Lint、Typecheck、Build、Surface Matrix 与 Diff 检查
- [x] 3.2 保留本地数据部署并验证 database、migration、worker、runner、artifact、BoxLite、provenance 与 AI readiness
- [x] 3.3 通过 API 与数据库验证两个公开仓库的分析终态、Wiki 页面、Citation 与审核状态

## Phase 4：审查并收口交付

- [x] 4.1 完成 Change Review，并对账实现、运行恢复、数据边界和 E2E Evidence
- [x] 4.2 同步正式制品与索引，关闭 Objective 并创建原子 Commit
