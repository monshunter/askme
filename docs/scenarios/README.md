# Scenarios 工作区

## 目的

保存真实 E2E 场景合同、前置条件、步骤、预期结果和当前证据引用。

## 制品与命名

- 场景文档使用稳定场景 ID 或与项目既有测试编号一致的文件名。
- 日志、截图和录像存入项目制品目录；本文档只保存摘要与引用。

## 生命周期与归档

使用 `draft → ready → verified → retired/archive`，不得把 mock 或代码测试包装成真实 E2E。

## 负责的 Skills

`autogo-e2e-run`、`autogo-env-manage`。

## INDEX 维护

Agent 在场景合同或验证状态变化后同步维护 `INDEX.md`。
