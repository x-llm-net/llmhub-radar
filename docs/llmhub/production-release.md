# LLM-Hub 生产发布

## 唯一生产目标

`llm-hub.store` 与旧 X-LLM 是两套独立部署。LLM-Hub 的生产目标固定为：

| 项目 | 值 |
| --- | --- |
| Git 仓库 | `x-llm-net/llmhub-radar` |
| SSH 别名 | `llm-hub` |
| 远端主机名 | `ser8272651662` |
| Compose 目录 | `/opt/llm-hub` |
| Compose 项目 | `llm-hub` |
| 服务 / 容器 | `new-api` / `llm-hub-new-api` |
| 镜像仓库 | `llm-hub/new-api` |
| 公网地址 | `https://llm-hub.store` |

禁止使用 `x-llm-net`、`ghcr.io/x-llm-net/new-api`、Docker Hub 或旧 X-LLM 发布脚本部署本站。以上值的机器可读版本位于 `scripts/llm-hub/production-target.json`。

## 发布入口

生产发布只能通过仓库内的 PowerShell 脚本执行：

```powershell
# 只读核验本地仓库和生产目标
.\scripts\Release-LlmHub.ps1 -Action Preflight

# 归档指定提交、上传、构建镜像并运行隔离预启动检查；不切换流量
.\scripts\Release-LlmHub.ps1 `
  -Action Prepare `
  -Commit HEAD `
  -ReleaseTag llmhub-abcdef0-20260815-1

# 得到用户在切换前的明确确认后，备份并替换生产容器
.\scripts\Release-LlmHub.ps1 `
  -Action Deploy `
  -Commit HEAD `
  -ReleaseTag llmhub-abcdef0-20260815-1 `
  -ConfirmProductionSwitch

# 独立复核线上版本、健康状态和主要页面
.\scripts\Release-LlmHub.ps1 `
  -Action Verify `
  -Commit HEAD `
  -ReleaseTag llmhub-abcdef0-20260815-1
```

版本格式固定为 `llmhub-<提交短哈希>-<YYYYMMDD>-<序号>`。它是服务器本地 Docker 镜像标签，不是 Git 标签；不要为 LLM-Hub 发布推送 `llmhub-*` 或 `xllm-*` Git 标签。上游通用 Docker、二进制 Release 和 GitCode 同步工作流也显式忽略这两个标签前缀。

## 强制校验

脚本在每个阶段重新检查：

1. 当前仓库根目录和 `origin` 必须是 `x-llm-net/llmhub-radar`。
2. 所有已跟踪文件必须干净；构建只使用指定提交的 `git archive`，不打包工作区临时文件。
3. 版本中的提交短哈希必须与实际构建提交一致。
4. SSH 别名、远端主机名、compose 文件、compose 项目、服务、容器和镜像前缀必须全部匹配目标清单。
5. 生产 compose 中不得出现旧 X-LLM 或 GHCR 镜像。
6. 新镜像先使用临时 SQLite 启动，再对生产 MySQL 执行一致性只读备份，把快照导入隔离的临时 MySQL 8.4 容器，完整执行迁移并通过 `/api/status`；预检不在生产数据库执行迁移或写入，也不开放公网端口。
7. 切换前必须确认没有运行中的渠道测试任务，备份 MySQL、`.env` 和 compose，并给旧镜像添加回滚标签。
8. `Deploy` 和 `Rollback` 没有 `-ConfirmProductionSwitch` 时直接拒绝执行。

## 上线前复盘闸门

2026-08-24 已完成四路只读复盘，覆盖租户与权限、路由与健康、计费与收益、发布与生产安全。复盘没有修改代码；上线前仍按以下闸门执行：

- [x] 数据库资格查询失败时，数据库直查选路改为失败关闭，不再把未过滤的 Channel 候选继续送入路由；同时保留定向回归测试。
- [x] `TrustQuota` 按 New API 现有行为保留，不另行关闭或重做预扣规则。它允许部分请求先完成、再按实际用量结算；余额出现负数时沿用 New API 的现有处理方式。该行为需要监控，但不作为本轮代码阻断项。
- [x] 业务确认一个渠道商只能归属一个总代理。当前 `HubProvider.tenant_id` 是单值归属，渠道、收益、提现和权限均沿该归属计算；不引入渠道商多租户关联或入口/服务双归属。
- [x] 新建渠道商入口要求可信总代 Host 上下文，并由服务端写入明确的 `HubProvider.tenant_id`；管理员创建入口同样要求当前租户或超级管理员明确选择目标租户。
- [x] 两层分账按万分比快照：渠道商服务费率默认 `1000 = 10%`，平台抽成率默认 `1000 = 10%`，平台只从总代理毛收入中抽取；新账单的四项收入之和必须等于用户实际扣费。
- [x] 分账兼容旧数据：`tenant_id IS NULL` 的历史渠道继续走旧解释；已归属总代理的新请求保存 `tenant_id`、两层费率和 `settlement_version = 2`，配置修改不回算历史账单。
- [x] 兜底引流佣金仍从实际服务渠道商收入扣除，不与平台代理抽成重复计算；失败尝试不生成收益。
- [ ] 正式数据初始化前清理历史 `HubProvider.tenant_id IS NULL`，并核对每个 `HubSupplyGroup` 都能关联到一个明确归属的渠道商。
- [ ] 对独立日志库、Redis 多实例、Caddy/DNS/TLS 和回滚后的数据库兼容性执行生产环境核验；代码测试不能替代这些基础设施检查。

上述未完成项中，历史数据归属仍是正式公网发布前的清理项；计费信任额度和渠道商单一归属已按当前业务规则接受，不再为了这两项扩大重构范围。

## 回滚

发布脚本的健康检查失败时会自动恢复旧 compose。若部署后功能验收失败，使用同一版本号回滚：

```powershell
.\scripts\Release-LlmHub.ps1 `
  -Action Rollback `
  -Commit HEAD `
  -ReleaseTag llmhub-abcdef0-20260815-1 `
  -ConfirmProductionSwitch
```

回滚默认只恢复上一镜像，不还原数据库。只有确认迁移造成数据损坏时才考虑恢复 MySQL 备份。

## 入口访问日志

生产 Caddy 配置由 `scripts/llm-hub/caddy/Caddyfile` 管理。根域名和渠道商通配域名都写入 JSON 访问日志：

```text
/var/log/caddy/llm-hub-access.json
```

日志只包含请求元数据、Cloudflare 请求头、HTTP 状态码、Caddy 到应用的耗时和应用返回的 `X-Oneapi-Request-Id`，不记录请求体、Authorization 或上游密钥。文件按 100 MiB 轮转，保留 7 个文件或 7 天。

排查入口 522 时，先按截图时间查询该文件：

```bash
sudo grep 'x-llm.llm-hub.store' /var/log/caddy/llm-hub-access.json
```

如果 Cloudflare 显示 522 但 Caddy 没有对应记录，说明请求没有到达源站；如果有记录，则结合 `status`、`duration` 和 `X-Oneapi-Request-Id` 查询容器日志及后台请求日志。

## 事故记录

2026-08-15 曾在核验实际生产目标前推送 `xllm-*` Git 标签，误触发上游 Docker Hub 和通用二进制 Release 工作流。该流程没有替换生产容器，但暴露出发布目标依赖对话记忆的问题。本文件、目标清单、发布脚本和工作流排除规则共同作为后续防线。
