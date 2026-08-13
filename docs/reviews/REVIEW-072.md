# REVIEW-072：SPEC-002 多页 Repository Wiki 与知识库语义 Review

## 审查对象

- Objective：`OBJ-009`
- Plan：[PLAN-014](../plans/PLAN-014.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Revision：`SPEC-002 sha256:602f94518130213d417244badea6bb64af97680716d21756998c815ef0235990`
- 审查日期：2026-08-14

## 产品结果与边界

- 合同已把 Repository Analysis 的首要结果从离散 Claim 改为按真实内容生成的 1–N 个 Markdown Wiki 页面；页面需要帮助读者理解系统边界、架构、模块关系、关键工作流、运行方式、扩展点和限制，而不是只复述少量实现事实。
- Pi 在 sandbox 独立输出目录写 Markdown，最终 control envelope 只返回页面 manifest、Citation 和 coverage；Host 在销毁 microVM 前 copy-out 并执行确定性校验，源码挂载继续只读。
- Generated Version 与 Approved Projection 分离；未审核 Wiki 只能在 Candidate 审核页查看，批准后才与已索引上传资料进入同一统一知识检索链路。实时 Deep Analysis 结论和原始源码正文都不会成为长期知识材料。

## 可验收性与权限

- `AC-WIKI-001/002/003` 分别覆盖生成与 copy-out、逐页 Markdown 审核、批准后统一检索及旧 active 延续，能够由文件、数据库、API、浏览器和真实问答 Evidence 直接验证。
- 四级 Repository visibility 继续约束 Candidate/Public 使用和 Citation 投影；批准、降权、撤销与 active projection 切换都由 Host 事务和最终消息写入前的权限复核拥有。
- 默认预算明确为 50 rounds、80 tools、1M 输入上下文和 200k 单次输出；提高工具数是为满足大型仓库跨子系统代表性读取，同时保留工具剩余数提示和最后 10 次强制收口，不构成无界探索。

## 一致性

- Material 与 Repository 保持不同聚合，但在 Approved evidence 层统一；Material 使用 Chunk Citation，Wiki 使用 page/section marker 与不可变源码 Citation，没有把 Repository 重新伪装成 GitHub Material。
- 新 Revision 的待审核或失败结果不会替换旧 Approved Wiki；Claim-only legacy 行保留但退出 current consumer，符合保留数据部署与单一当前语义 owner。

## 结论

`PASS`

下一路由：按 [DESIGN-005](../architecture/DESIGN-005.md) 实施并验证 sandbox writer/copy-out、Wiki projection、统一 EvidenceProvider 与固定仓库真实场景。
