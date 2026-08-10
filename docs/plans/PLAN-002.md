# PLAN-002：闭环资料导入与职业知识库

## 目标

让 Candidate 能把真实文件或外部来源导入 Askme，由可恢复 worker 组织为可搜索、可编辑且始终可追溯到 Source Material 的 Career Knowledge Base，并在 Candidate Dashboard 看到真实进度与指标。

## 范围

本 Plan 覆盖 Candidate owner 范围内的文件上传、GitHub/Notion/Website 快照、资料生命周期、后台提取与 AI 整理、Knowledge Base 查询编辑，以及 Dashboard、Upload Materials、Knowledge Base 三个设计稿页面；隐私控制、Agent 对话、发布与 Admin 治理由后续 Plan 继续交付。

## Phase 1：Source Material 边界

关联 Spec：[SPEC-001](../specs/SPEC-001.md)

- [ ] 1.1 实现六类文件的校验、owner 隔离存储与持久资料状态
- [ ] 1.2 实现 GitHub、Notion 与 Website 的安全快照导入
- [ ] 1.3 实现资料列表、失败重试、删除清理与审计接口

## Phase 2：后台组织流程

- [ ] 2.1 实现可租约、幂等恢复的 job 领取与六类文件/快照文本提取
- [ ] 2.2 实现 Chunk 索引、DeepSeek 知识组织和来源关系写入
- [ ] 2.3 实现可重试与终态失败的状态收敛、heartbeat 和安全错误反馈

## Phase 3：Knowledge Base 能力

- [ ] 3.1 实现分类、搜索、筛选、分页、详情与 Citation readiness 查询
- [ ] 3.2 实现允许字段编辑并保持 Source/Citation 追溯
- [ ] 3.3 实现 Dashboard 指标、工作流、最近资料与下一步聚合

## Phase 4：Candidate 产品界面

- [ ] 4.1 交付 Upload Materials 设计页面的真实导入、进度、最近资料和错误状态
- [ ] 4.2 交付 Knowledge Base 设计页面的真实浏览、筛选、详情和编辑状态
- [ ] 4.3 交付 Dashboard 设计页面的真实指标、工作流和推荐操作

## Phase 5：验证与收口

- [ ] 5.1 完成 owner 隔离、格式提取、job 恢复、搜索编辑和删除影响的自动化验证
- [ ] 5.2 完成 Docker 中 Candidate 导入到知识库的真实 Chrome 桌面/移动场景
- [ ] 5.3 完成 Change Review、AC 对账、索引、Progress 与原子 Commit
