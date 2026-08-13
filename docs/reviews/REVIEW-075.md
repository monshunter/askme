# REVIEW-075：PLAN-014 Repository Wiki 与全站回归 Change Review

## 审查对象

- Objective：`OBJ-009`
- Plan：[PLAN-014](../plans/PLAN-014.md)
- Spec：[SPEC-002](../specs/SPEC-002.md)
- Design：[DESIGN-005](../architecture/DESIGN-005.md)
- Scenario：[SCN-002](../scenarios/SCN-002.md)
- 分支：`feat/repository-code-agent-v1`
- 审查日期：2026-08-14

## 审查范围

本次审查覆盖通用 OpenAI-compatible AI Profile、Repository/Revision/Artifact/Wiki/Analysis Run 数据与 API、GitHub 同步及安全过滤、Pi + BoxLite guest、Host runner、Wiki copy-out/校验/审核、统一 EvidenceProvider、Candidate/Public/Admin 投影、SSE/调度/配额/readiness、Candidate Repository UI、Repository Citation Markdown 来源弹窗、0012–0017 migration、固定 public/private Repository 验收以及全站页面、API、package 入口和保留数据部署。

## 正确性与系统边界

- Repository 已从文档型 Material 中退出；源码不创建 Chunk、embedding、AST 或向量索引。只有 Approved Wiki section 与已索引上传资料进入统一 EvidenceProvider，未审核 Wiki 和实时 deep 结果不会成为长期知识。
- Pi 只在每 run 新建的 BoxLite microVM 中使用固定只读 source tools 与受限 `write_wiki`；完整 Markdown 由 guest 写入隔离目录，Host 在 cleanup 前 copy-out 并 fail closed 校验文件、Markdown、Citation、coverage、预算和权限。cleanup 成功前不会提交结果。
- Repository Citation 的 API 继续返回结构化授权数据；Candidate/Public UI 在当前页将其投影为 Markdown 来源弹窗。请求每次重验 owner 或 visitor session、publication、visibility、消息 Citation、不可变 SHA 与源码 hash，JSON API 不再作为用户导航目标。
- 新 Revision 或重跑不会提前替换旧 active Approved Wiki；Candidate approval 才原子切换 active revision/projection。运行版本漂移只标记 outdated，失败结果不伪装成成功。
- Repository/private Token 只存在于一次同步请求；host runner 明确移除测试 Token，固定 private 场景对数据库、artifact、日志与持久目录的扫描没有命中。
- 队列授权检查先于 image/profile 能力检查；被撤销的 private Repository 即使运行环境暂时缺少 image 配置也稳定返回授权错误，不会错误暴露为 capability 状态。

## 兼容、安全与恢复

- 0012–0017 在空库与保留数据数据库均顺序应用；旧 GitHub material 的显式删除符合用户已批准范围，非目标数据在最终 Compose 重建前后计数逐项一致。
- Archive 路径逃逸、symlink、特殊文件、已知二进制、容量上限和排除规则均由 Host 在 artifact 建立前处理；Artifact 不可变，retention/GC 只按精确引用回收。
- SSE 只投影 run id/version/safe phase，终态从授权 GET 获取；权限撤销、publication 失效、取消、lease expiry、runner crash 与 cleanup failure 均有确定性状态和恢复路径。
- 服务端默认预算为 50 rounds、80 tools、1,000,000 context、200,000 output、Repository 日配额 10；公共自动分析不能越过 identity、publication、visibility、开关、并发和配额门禁。
- 回滚边界是关闭 Code Agent/公共深度开关并停止 host runner，保留新表、Artifact 与既有 volume；不依赖 destructive reset。

## 当前 Evidence

- 最终门禁：Vitest `68 files / 241 tests`、ESLint、Next typegen + `tsc --noEmit`、`git diff --check`、production build `24 / 24`、surface matrix `18 pages / 59 API routes / 65 methods / 26 verification entrypoints` 全部 PASS。
- 固定 public `QuantumNous/new-api@ccd535ef8e50cf6e5846a59278c40b7ff59d1b7d`：7 个 Wiki 页面、35 个实质 H2、30 个跨子系统 examined paths、12 个 covered areas、77 个源码 Citation、Mermaid 与 10 题基准全部 PASS。
- 固定 private `monshunter/copybook@10abc90f0d244485c0983a79f0c79238671bd3f0`：6 个 Wiki 页面、33 个实质章节、34 个 examined paths、8 个 covered areas、21 个源码 Citation；一次性 Token、固定 SHA、撤权、清理与泄露扫描 PASS。
- 26 个 package smoke/E2E/lifecycle 入口全部当前执行并 PASS；真实 BoxLite sandbox、Repository Analysis Runner、SSE、调度、治理、retention、public/private 固定仓库和 Docker lifecycle 均包含在内。
- 浏览器覆盖 anonymous/Candidate/Admin 的 18 个页面、desktop `1440 × 1000` 与 mobile `430 × 932`；Candidate Repository 页面只有目录标题处一个“添加仓库”按钮，新增表单位于 modal，卡片列出已添加 Repository，无刷新按钮和横向溢出。
- 最终部署中的 Candidate Repository Citation 点击前后标签页数量保持 1；弹窗显示 Repository、完整 SHA、path/range 与真实 Go 源码，不显示 raw JSON；Escape 关闭后焦点返回原 Citation，console warning/error 为 0。
- 保留数据部署后 database/migration/worker/runner/artifact/boxlite/provenance/AI 全部 `ready`，Code Agent capability 为 `ready`；Compose 网络内 Candidate/Admin auth、角色守卫、logout 撤权和真实外部 AI check PASS。

## 发现

没有阻塞正确性、安全、兼容、恢复或验收的发现。

非阻塞说明：项目仍是本地开发交付，V1 明确不包含对象存储、多 Web 实例事件总线、向量检索、跨 Repository 分析、计费与 warm sandbox；这些延迟项没有被当前实现暗示为已完成。

## 结论

`PASS`

PLAN-014 的实现、固定输入、全站回归、保留数据部署与用户最新 UI 修订均满足 SPEC-002、DESIGN-005 和 SCN-002。下一路由：对账验收清单、Plan、Progress、docs index 与 Git，创建原子 Commit 并按用户明确授权推送当前分支。
