# REVIEW-040：Askme 中文品牌 Design Review

## 审查对象

- 制品：[DESIGN-003](../architecture/DESIGN-003.md)
- Boundary ID：`askme-ui-i18n-a11y`
- 变更：英文 wordmark 保持 Askme，中文品牌文字和红色印章统一为“职问”
- 审查日期：2026-08-12

## 边界与复杂度

- 现有 wordmark/印章均为静态可见文本，不需要新增 catalog key、客户端状态、资源文件或接口。
- 精确替换静态品牌字符串可以覆盖登录、Candidate、公共 Agent、Admin、邀请和不可用页面；保留“询问候选人”等普通中文语义，避免无关文案变更。
- 两字印章保持现有几何与 CSS，不引入布局结构变化；真实桌面与移动截图仍需确认字体、重叠和 overflow。

## 失败与恢复

- 漏改会由 TSX 全局回归测试和浏览器代表路由检查暴露；回滚只涉及静态文案和合同，无数据恢复。

## 结论

`PASS`

下一路由：建立旧品牌残留的红灯测试并实施 `PLAN-009` Phase 2.5。
