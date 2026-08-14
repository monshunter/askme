# REVIEW-115：PLAN-024 公共 Agent 相关性修复 Plan Review

被审制品：`PLAN-024`

Revision：`sha256:9c139ab7ac2fb8868ead457be1912580ba6d76fce00026dd89141857dad25312`

Verdict：`PASS`

## 审查结论

- 单一 Plan 聚焦一个用户结果：核心实体没有授权 Evidence 时返回证据不足，不再用其他项目内容答非所问，并在现有“牛鼻子”公开 Agent 上闭环真实验收。
- `SPEC-002` 已规定核心方面均无支持时 Coverage 必须为 `none`；当前 Trace 却把 `unsupportedAspects: ["askme"]` 的问题判为 `partial` 并发布 OneCat Claim，因此本次属于实现漂移，不需要新增 Spec 或 Design。
- Phase 按失败回归、Host Coverage 修复、工程门禁、保留数据部署、API/浏览器 E2E 与 Change Review 排序，先用自动化建立行为边界，再更新真实运行环境，顺序合理。
- Item 可独立领取并以测试、运行状态、公开消息 outcome、Citation 数、浏览器可见结果和 Console/Network 观测判断完成；Plan 没有复制实现步骤、日志或额外状态。
- 验收同时覆盖 Askme 无证据、新会话、OneCat 后追问 Askme 与 OneCat 正常回答，能区分“相关性门禁生效”和“公共 Agent 被整体拒答”。
- 实现必须只在核心实体与 must term 完全缺少支持时 fail closed；同义改写、合法 partial、多轮指代与相关问题仍需由语义检索和现有 Coverage 路径回答，不能把修复扩大为全文字面匹配。
- 本机 Compose 重建使用既有保留数据入口，不 reset volume、不修改 Secret、不改变权限或生产环境，无额外 Human Gate。

下一路由：执行 Phase 1，从 `autogo-tdd` 建立 Askme/OneCat 最小失败用例，再由 `autogo-change-implement` 完成 Host Coverage 最小修复。
