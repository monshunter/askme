# REVIEW-111：SPEC-001 公开 Agent 与预览重置增量 Spec Review

被审制品：`SPEC-001`

Revision：`sha256:e4957aeea7c3378562993817e0be3a0ca1e94100e0c8e9eea8a2c2bcc2c2a0d4`

Verdict：`PASS`

## 审查结论

- 公共页的语言位置、右栏删减和推荐问题一致性直接对应用户给出的页面与参考图，没有扩大公开数据、游客身份或问答权限边界。
- 语言合同保留每页唯一入口和 locale 持久化，只将公共 Agent 从固定全局位置改为页眉信息流位置，正常滚动与“不浮动”可独立验收。
- Preview 重置明确限定当前 Candidate owner 的全部 preview Conversation，定义了确认、级联清理、新空会话、回答或分析进行中时拒绝，以及不受影响的数据边界。
- `AC-AGENT-006`、`AC-PUB-005` 与修订后的 `AC-UI-005` 分别覆盖会话状态、公共页交互和跨页面语言唯一性，能够通过 API、数据库、结构测试和真实浏览器独立验证。
- 既有 `SPEC-001` 是上述产品行为的唯一事实 owner，无需新建重复 Spec 或修改 Repository、RAG、发布与公共游客会话设计。

下一路由：进入 `autogo-tdd` 建立失败保护，再由 `autogo-change-implement` 完成最小实现。
