# PLAN-017：闭环认证、游客会话隔离与 Citation 修复

## 目标

让 Candidate 拥有完整、自助且安全的注册、登录、注销、忘记密码、重置密码与登录后改密流程；以统一 SMTP 能力承载密码重置和 Admin 邀请，并用本地 Mailpit 验证真实投递；让一个浏览器以 localStorage 中的稳定游客凭证成为独立身份，并按公开 Agent 隔离和恢复自己的会话；同时修复 Repository marker 格式不兼容与函数实现问题误走浅层 RAG 导致的回答失败，并在保留数据的真实运行环境完成端到端验收。

## 范围

本 Plan 覆盖 Candidate 认证生命周期、统一 SMTP transport、密码重置与 Admin 邀请邮件、Mailpit 本地投递、会话撤销、公共游客凭证、旧 cookie 平滑迁移、公开 Conversation 身份隔离、Repository Citation marker 解析、源码问题路由、数据库迁移、API/UI、测试、部署与浏览器验收；不开放 Admin 自助注册或密码重置，不引入第三方 OAuth，不选择或部署生产邮件供应商，不把游客凭证升级为 Candidate 账号，不清空现有账号、资料、会话或上传文件，也不执行生产环境发布。

## Phase 1：修订认证、游客与回答合同

- [x] 1.1 修订 Candidate 完整认证生命周期与密码安全验收合同
- [x] 1.2 修订浏览器游客身份、公开会话隔离与兼容边界合同
- [x] 1.3 修订 Repository marker 规范化与源码细节路由合同
- [x] 1.4 完成 Spec 与 Design Review

相关合同：[SPEC-001](../specs/SPEC-001.md)、[SPEC-002](../specs/SPEC-002.md)、[DESIGN-001](../architecture/DESIGN-001.md)、[DESIGN-005](../architecture/DESIGN-005.md)

## Phase 2：修复 Citation 与源码问题路由

- [x] 2.1 用失败测试固定带方括号 marker 与函数实现细节问题的行为
- [x] 2.2 实现 marker 规范化和确定性源码检查路由
- [x] 2.3 验证 copybook `paginate` 问题返回带有效源码 Citation 的答案

## Phase 3：交付 Candidate 完整认证

- [x] 3.1 交付注册、密码重置与会话安全所需的数据和领域服务
- [x] 3.2 交付认证 API、邮件发送与防枚举滥用边界
- [x] 3.3 交付注册、忘记密码、重置密码与账号安全界面
- [x] 3.4 统一密码重置与 Admin 邀请的 SMTP transport，并覆盖配置、超时与安全失败语义
- [x] 3.5 完成认证单元、集成与 Mailpit 双邮件场景验证

## Phase 4：交付浏览器游客隔离

- [x] 4.1 用失败测试固定浏览器级凭证、旧 cookie 迁移和跨游客隔离
- [x] 4.2 实现 localStorage 游客凭证与服务端统一 token 解析
- [x] 4.3 实现公开会话复用、滚动保留和全部公共资源 owner 校验
- [x] 4.4 完成两个游客跨 Agent、跨会话的隔离验证

## Phase 5：部署并完成真实用户验收

- [x] 5.1 完成全量静态、单元、集成与 surface 门禁
- [x] 5.2 保留数据重部署本地 Compose 并验证迁移、健康和数据留存
- [x] 5.3 在真实浏览器完成 Candidate 认证、两游客隔离与 copybook 回答验收

## Phase 6：对账并关闭交付

- [x] 6.1 完成 Change Review 与必要 Reconcile
- [x] 6.2 对账 Spec、Design、Plan、Progress、运行 Evidence 与 Git
- [x] 6.3 创建原子 Commit 并关闭 Objective
