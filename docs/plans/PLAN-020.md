# PLAN-020：交付真实 Hybrid Agentic RAG V2

## 目标

用可评估、可诊断、权限优先的 Hybrid Agentic RAG V2 直接替换现有全文检索问答，使简历等职业材料和已批准 Repository Markdown/PDF 能被稳定召回、融合、验证并生成可追溯 Citation 的回答。

## 范围

更新 Agent 与 Repository 长期合同和系统设计，交付独立 Embedding/Rerank Provider、pgvector 版本化索引、Parent–Child chunk、多路混合检索、有界两轮 Agentic RAG、证据血缘与 Claim 验证、Repository 文档索引、检索 Trace、120 题评估和真实环境验收。V2 不保留 V1 检索兼容链路；账号、原始材料、Knowledge Item、Repository、权限和会话等业务数据必须保留，已有派生检索数据允许清空重建。扫描版 PDF OCR、原始源码 Embedding、在线自学习和新的生产发布能力不在本 Plan 范围内。

## Phase 1：固化 V2 合同与设计

- [x] 1.1 固化已确认的 Hybrid Agentic RAG 工作流与项目术语
- [x] 1.2 更新并审查 Agent、Repository 文档与权限产品合同（[SPEC-002](../specs/SPEC-002.md)）
- [x] 1.3 更新并审查 V2 数据、检索、Agent、失败恢复与观测设计（[DESIGN-005](../architecture/DESIGN-005.md)）

## Phase 2：交付版本化索引基础

- [x] 2.1 以测试保护独立 Embedding、Rerank Provider 与可配置预算
- [x] 2.2 交付 pgvector、索引版本、派生数据重建与原子激活模型
- [x] 2.3 交付结构优先的 Parent–Child 材料切分与索引流水线
- [x] 2.4 交付 Repository Markdown/PDF 安全发现、索引与 repository 级发布语义

## Phase 3：交付有界 Hybrid Agentic RAG

- [x] 3.1 以测试交付确定性中文处理与结构化 Query Planner
- [x] 3.2 交付 exact、lexical、vector、structured 多路召回与可配置 RRF
- [x] 3.3 交付独立 Rerank、证据融合、覆盖判断与一次有界补检
- [x] 3.4 交付 Claim 级回答、独立验证、Citation 校验与强撤销
- [x] 3.5 交付 Candidate/Admin Retrieval Trace 与索引状态反馈

## Phase 4：建立 V2 发布门禁

- [x] 4.1 建立三名虚构 Candidate、跨来源材料与 120 题 Golden Dataset
- [x] 4.2 自动化召回、排序、Citation、拒答、权限、降级与 Prompt Injection 门禁

## Phase 5：真实验收与收口

- [x] 5.1 完成自动化验证、数据与安全检查及 Change Review
- [x] 5.2 保留业务数据部署 V2 并重建派生检索索引
- [x] 5.3 使用目标账号完成富途经历、Repository 文档与权限撤销真实浏览器验收
- [x] 5.4 对账正式制品、Progress 与 Git 并关闭交付
