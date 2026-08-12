# 2026-08-12：Askme 容器镜像重建

记录类型：delivery

路由：Fast

## 目标与范围

为 revision `9a2acba` 重建并导入 Askme 本地 Compose 的 web、worker、migrate 镜像；本次只更新镜像标签，不重建或部署现有 Askme 容器，不修改代码、配置、数据或 volume。

## 本次实际完成

- 初始 Docker Desktop 构建在 Next.js production build 阶段失活；Docker VM 日志连续记录 OOM kill。单 worker Turbopack 和低内存 Webpack 对照仍触发 OOM，证明根因是 8 GiB Docker VM 被 GitLab、Ferry 与其他本地环境占用，而不是当前 revision 无法构建。
- 在独立的临时 Colima `askme-build` profile 中使用原始 Dockerfile 完成构建；Turbopack 编译、TypeScript、24 个静态页面、standalone runtime 层与镜像导出全部成功。
- 经用户授权重启失活的 Docker Desktop，在其他高内存容器尚未恢复时导入同一镜像制品；`askme-local-web:latest`、`askme-local-worker:latest`、`askme-local-migrate:latest` 均指向 `sha256:1d953e409cce2bbd79fe6c9d2e5396c46688c3cb61c8296e6e183e9286853967`，创建时间为 `2026-08-12T11:55:00+08:00`，架构为 `arm64`。
- 使用新镜像启动隔离验证容器：`/api/health/live` 与 `/api/health/ready` 均返回 200；`/workspace/publish`、`/workspace/publish/preview`、`/api/publications/preview` 均返回 404。验证容器随后删除。
- Docker Desktop 重启后，Askme、EasyInterview 与 registry 的原运行容器自动恢复；Ferry 标准 `local-gitlab.sh` 使用保留的持久目录幂等重建 GitLab，最终为 healthy。
- 临时 Colima profile、虚拟磁盘与 397 MiB 镜像 tar 已删除；Docker context 保持 `desktop-linux`。

## 当前运行边界与风险

- 现有 `askme-local-web-1` 与 `askme-local-worker-1` 容器 ID 未变，仍运行重建前的旧镜像；当前 `http://127.0.0.1:3000` live/ready 均成功。只有后续得到部署授权并重建容器后，运行实例才会切换到新镜像。
- Docker Desktop 重启前运行的 `ferry-local-dev` 两个 Kind 节点未保留在容器存储中。Ferry checkout 当前含一组无关未提交 UI 变更，因此本次没有擅自运行全量 `env-setup.sh` 重建并部署该工作树；GitLab 已恢复，Ferry cluster 保持 stopped。
- Docker Desktop 的 8 GiB VM 在 GitLab 与 Ferry 同时运行时没有足够余量完成 Askme 镜像构建；再次构建应继续使用隔离 builder，或先由相关环境 owner 明确释放内存/提高 Docker Desktop 内存。

## 恢复与下一步

- 新镜像已安全保存在 Docker Desktop，本次构建不依赖已删除的临时制品。
- 若需要部署新镜像，应作为独立授权动作执行 Compose 容器更新并验证 migrate、web、worker 健康；不得把本次“镜像已重建”误报为“运行实例已升级”。
- 若需要恢复 Ferry，先对账其无关 dirty 工作树，再由 Ferry 的 `test/scenarios/local-dev/env-setup.sh` owner 幂等重建并验收环境。

## 预期 Commit subject

`docs: record container image rebuild`

Journal 不回填 Commit hash；实际关联由 `git log -- docs/journal/2026-08-12-container-image-rebuild.md` 查询。
