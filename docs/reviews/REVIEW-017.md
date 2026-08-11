# REVIEW-017：SPEC-001 移动验收基线变更 Review

## 审查对象

- 制品：`SPEC-001` 的移动端视口行为与 `AC-UI-002`
- Revision：`HEAD c2a3be2 + 2026-08-11 用户批准的 iPhone 14 Pro Max 验收变更`
- 唯一父 Plan：`PLAN-004`
- 审查日期：2026-08-11

## 发现

- 用户明确要求后续由 Agent 自行打开 Chrome DevTools，并直接选择 `iPhone 14 Pro Max`；提供的当前截图证明该设备配置为 430 × 932。
- Spec 只把移动验收基线从手工 390 × 844 调整为 Chrome 可复现的命名设备配置，没有缩小无横向溢出、导航、表单、隐私控制、Chat 或真实操作要求。
- 桌面 1448 × 1086 设计稿基线未改变；`DESIGN-002` 与 `PLAN-004` 已使用同一移动设备与尺寸，不存在双重验收真理源。
- 设备名称、实际 `innerWidth/innerHeight`、overflow、console 和关键操作均可由 Chrome 独立验证，AC 仍然明确且可测试。

## 结论

`PASS`

下一路由：执行 `PLAN-004` 更新后的 Item 4.3，并以 Chrome 页面实际几何而非设备下拉标签单独作为 Evidence。
