# 2026-08-17：SMTP 环境配置分层修订

记录类型：delivery

路由：Fast

## 目标与范围

让项目 `.env` 能覆盖 `~/.env` 中的机器级默认配置，同时继续保留进程环境变量的最高优先级；补充本地与生产 SMTP 配置说明，并忽略本地 `temp/` 临时目录。

## 本次实际完成

- `scripts/docker-up.sh` 按 `~/.env`、项目 `.env` 的顺序向 Docker Compose 传入环境文件，后者覆盖前者，Shell 进程环境变量仍保持最高优先级。
- 服务端运行配置按 `process env > project .env > ~/.env > defaults` 读取允许的环境变量；高优先级空值不会遮蔽低优先级有效值。
- `.env.example` 说明 Mailpit 与真实 SMTP 的切换方式和优先级；`.gitignore` 忽略本地 `temp/` 目录。
- 配置单测覆盖项目 `.env`、`~/.env` 与进程环境变量的优先级。

## 验证边界

- 已执行配置定向测试、Shell 语法检查、TypeScript 类型检查与 `git diff --check`。
- 本次未修改真实 Secret，未部署或重启 Compose，未向真实 SMTP 发送邮件。

## 恢复方式

- 代码层可直接回退本次 Commit。
- 运行配置异常时，依次检查当前进程环境、项目 `.env`、`~/.env` 与 Compose 默认值；不要在日志或 Journal 中记录 SMTP 密码。

## 预期 Commit subject

`fix(config): honor project environment overrides`

Journal 不回填 Commit hash；实际关联由 `git log -- docs/journal/2026-08-17-smtp-env-layering.md` 查询。
