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
6. 新镜像先在无生产数据库、无生产 Redis、无公网端口的临时容器中启动，并通过 `/api/status`。
7. 切换前必须确认没有运行中的渠道测试任务，备份 MySQL、`.env` 和 compose，并给旧镜像添加回滚标签。
8. `Deploy` 和 `Rollback` 没有 `-ConfirmProductionSwitch` 时直接拒绝执行。

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

## 事故记录

2026-08-15 曾在核验实际生产目标前推送 `xllm-*` Git 标签，误触发上游 Docker Hub 和通用二进制 Release 工作流。该流程没有替换生产容器，但暴露出发布目标依赖对话记忆的问题。本文件、目标清单、发布脚本和工作流排除规则共同作为后续防线。
