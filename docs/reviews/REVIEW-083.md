# REVIEW-083：DESIGN-005 精确 Citation、Deep 使用边界与会话推荐 Design Review

## 审查对象

- Objective：`OBJ-011`
- Plan：[PLAN-016](../plans/PLAN-016.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- Revision：`DESIGN-005 sha256:f6d292f0262ced494e1006d8d29f0d13508e54d073334813a45f667862b91bd4`
- 审查日期：2026-08-14

## 组件、状态与契约

- EvidenceProvider 只把 Repository alias 用作实体定位，回答模型选择 evidence 与精确 marker，Host 负责子集校验和最终持久化；权限和事实选择没有转交给模型。
- 安全 route audit 复用 `audit_events`，只保存 requested/effective route、稳定 reason code、confidence、repository id 与 evidence count，不复制问题、回答、prompt 或 reasoning。
- `conversations` 是推荐问题、context hash、更新时间和 refresh cursor 的唯一 owner；历史 Agent settings 字段仅保留不用，additive migration 与回滚边界明确。
- context hash 同时绑定 locale、cursor、全部可见消息与当前授权主题。空会话使用稳定引导，已有会话优先由 Router profile 生成，失败时确定性 fallback，推荐失败不会损坏已经完成的问答。

## 稳定性、资源与恢复

- Conversation Deep 不再访问日次数计数，但短窗口防滥用、并发、deadline、round、tool、token 与 microVM 限额仍形成有界执行；离线 Wiki resource quota 与实时问答用途分离。
- optimistic context hash 防止慢生成覆盖新消息；超长上下文的确定性分段压缩仍保留各轮主题，且当前真实小规模会话可以直接使用全部消息。
- 旧推荐字段、旧配额记录和旧设置值不需要破坏性删除；关闭新应用版本即可停止新路径，现有问答与历史消息保持可读。

## 验证覆盖

- 自动化覆盖 alias/section 负例、marker 子集、route reason、无日次数读写、会话 hash/fallback 与双会话隔离。
- 运行验收要求真实 `conversation_analysis` 完成，Candidate/Public 不因日次数拒绝，并在浏览器核对精准 Citation 与推荐问题随所属 Conversation 更新。
- 设计没有引入向量库、第二份消息事实源、常驻 Agent、计费模拟或新的外部依赖，符合最小充分方案。

## 结论

`PASS`

下一路由：按 [PLAN-016](../plans/PLAN-016.md) 进入 TDD 与实现。
