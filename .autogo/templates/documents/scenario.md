# SCENARIO-001：Agent 参考完整样例创建 Spec

> 这是真实 E2E 场景文档的结构样例。代码测试、fixture 或 mock backend 不能替代运行中系统的 E2E 证据。

## 用户与系统目标

用户只描述“为上传失败补充可验收规范”。Agent 应从已安装参考资料理解合格 Spec 的写法，并基于项目事实创建文档，不要求用户填写模板变量。

## 前置状态

- AutoGo 已安装到测试项目。
- `.autogo/templates/documents/spec.md` 存在且可读。
- 项目已有 `PROGRESS.md` 和父 Plan。
- `docs/specs/` 工作区已初始化。

## 操作步骤

1. 用户向 Agent 描述上传失败的目标和约束。
2. Agent 从 Progress 确认当前 Objective/Plan，再读取 Plan、代码事实和 Spec 参考样例。
3. Agent 创建新的 Spec，写明正常行为、失败边界、非目标和稳定验收项。
4. Agent 更新父 Plan 和文档索引；仅在 Objective 状态或内嵌 Plans Checklist 变化时更新 Progress。

## 预期结果

- 新 Spec 不包含未解析变量或示例项目事实。
- Spec 通过正文链接明确唯一父 Plan。
- 每个验收项都可以通过 API 或浏览器行为验证。
- 没有证据的验收项保持未完成。

## 证据

保存 Agent 创建的 Spec 路径、父 Plan diff 和索引 diff；若 Objective 状态或内嵌 Plans Checklist 变化，同时保存 Progress diff。若执行了运行时验收，再记录请求、响应或浏览器截图的可复核引用。

## 清理

测试项目位于隔离的 `temp/`。场景结束后保留用户要求的验收制品；不删除源码仓库或无关项目数据。
