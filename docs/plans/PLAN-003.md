# PLAN-003：闭环隐私、Agent 与公共问答

## 目标

让 Candidate 能逐份审核资料可见性，用真实证据预览自己的 Agent，完成发布与撤销；让匿名 Interviewer 只能在当前授权边界内进行持久多轮问答并获得真实 Citation。

## 范围

本 Plan 覆盖四级隐私策略、Candidate Agent 设置与预览、发布生命周期、公共访客会话与 Chat、对应 Candidate/Public 设计稿页面和跨角色验证；Platform Admin 治理、全站双语与最终跨页面可访问性审计由后续 Plan 继续交付。

## Phase 1：隐私边界

关联 Spec：[SPEC-001](../specs/SPEC-001.md)

- [x] 1.1 实现统一的 owner 与四级 visibility 授权矩阵及检索过滤
- [x] 1.2 实现逐项可见性修改、确认失效/重确认和 Interviewer 访问预览接口
- [x] 1.3 交付 Privacy Control 设计页面的真实策略、预览与确认状态

## Phase 2：Candidate Agent 预览

- [x] 2.1 实现有界证据检索、注入防护、DeepSeek 结构化回答与 Citation 校验
- [x] 2.2 实现预览会话、消息、失败恢复、回答反馈与审计持久化
- [x] 2.3 实现 Answer Tone、Public Mode、Privacy-Safe Mode 和推荐问题设置
- [x] 2.4 交付 Agent Preview 设计页面的真实多轮问答、来源和设置交互

## Phase 3：发布生命周期

- [x] 3.1 实现发布前置条件、不可推断 slug、发布、撤销与再发布状态机
- [x] 3.2 实现公共 profile/highlights 投影和与匿名访客完全相同权限的 Candidate 公共预览
- [x] 3.3 交付 Candidate 发布控制、分享链接、复制/下载和撤销交互

## Phase 4：Interviewer 公共 Agent

- [x] 4.1 实现匿名访客会话、限流、问题边界与公共 evidence 检索
- [x] 4.2 实现持久多轮公共 Chat、真实 Citation、反馈和不可用状态
- [x] 4.3 交付 Public Agent 设计页面的授权 profile、Chat-first、来源和推荐问题体验

## Phase 5：验证与收口

- [x] 5.1 完成可见性、跨 owner/访客隔离、发布状态、提示注入和 Citation 的自动化验证
- [x] 5.2 完成 Docker 中 Candidate 隐私→预览→发布→匿名 Chat→撤销的真实 Chrome 桌面/移动场景
- [x] 5.3 完成 Change Review、AC 对账、索引、Progress 与原子 Commit
