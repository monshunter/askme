---
name: autogo-env-manage
description: "发现并安全管理项目测试与运行环境；在实现、调查、E2E 或部署需要操作 Docker、Kubernetes、数据库和外部依赖，或这些环境异常时使用。"
---
# autogo-env-manage
## 目标
发现并安全管理项目运行、测试和依赖环境，保持状态透明、操作可逆和清理可控。
## 输入与发现
- 项目真实 README/Makefile/Taskfile/compose/manifests/scripts
- Progress 中当前 Objective 和 Plan；调用方内部目标从正式制品或 Agent Todo 读取
- 目标环境、当前状态、数据保留和风险要求

## 输出与持久制品
- 环境状态、执行动作和结果
- 端口、版本、依赖健康与异常
- 清理/恢复记录和下一步
- 写入对应制品的环境 Evidence、阻塞或下一步

## 副作用与 Human Gate
可能产生环境副作用；reset/delete/drop/prune、共享或生产环境操作必须先解析原授权范围，并在破坏性、生产、权限、Secret 或不可逆边界满足 Human Gate。

## 执行步骤
1. 从 Progress 确认当前上层 Plan，再从调用方制品确认具体环境操作
2. 先发现项目真实入口，不凭经验猜命令
3. 区分 inspect/status/prepare/start/stop/restart 与 reset/delete/prune
4. 变更前记录当前状态和影响范围
5. 优先使用项目已有脚本和隔离环境
6. 每个动作后执行健康检查并将 Evidence/下一步写入调用方制品
7. 破坏性动作在 Human Gate 前完成 inspect、Diff/Dry-run、备份和恢复准备；等待原因与精确恢复条件写入 Operation 等唯一事实 owner，不写入 Plan 或 Progress

## 验证与完成
- 目标服务健康且版本/配置正确
- 未误伤其他项目或共享环境
- 临时资源按约定清理或明确保留
- 环境结果与调用方内部目标一致，且不把环境细节写入 Progress

## 失败、重试与幂等
状态不明时停止破坏性操作；相同启动失败转 autogo-investigate。
- 重复执行前读取当前文件、Git 和运行状态；不重复创建已存在制品或重复执行已生效副作用。
- 相同失败再次出现时停止机械重试，回到 `autogo-investigate` 或上层设计。
- 状态和文档由 Agent 自动维护，不要求用户执行 Harness CRUD 命令。
