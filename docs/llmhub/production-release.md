# LLM-Hub 生产发布

## 唯一生产目标

`llm-hub.store` 与 X-LLM 是两套独立服务。`ssh llm-hub` 指向 LLM-Hub 专用主机，`ssh x-llm` 指向仍在运行的 X-LLM 生产服务。发布 LLM-Hub 时禁止连接或修改 `x-llm`。

LLM-Hub 于 2026-08-25 在 `/opt/llm-hub` 以全新 MySQL、Redis 和空业务库初始化，不迁移历史 LLM-Hub 数据。首次部署记录、旧服务备份位置、TLS 和 DNS 策略见 [colocation-migration-plan.md](colocation-migration-plan.md)。

| 项目 | 值 |
| --- | --- |
| Git 仓库 | `x-llm-net/llmhub-radar` |
| SSH 别名 | `llm-hub` |
| 发布脚本预期的远端主机名 | `llm-hub` |
| 远端地址 | `159.195.18.119` |
| Compose 目录 | `/opt/llm-hub` |
| Compose 项目 | `llm-hub` |
| 服务 / 容器 | `new-api` / `llm-hub-new-api` |
| 镜像仓库 | `llm-hub/new-api` |
| 公网地址 | `https://llm-hub.store` |

禁止使用 `x-llm-net`、`ghcr.io/x-llm-net/new-api`、Docker Hub 或旧 X-LLM 发布脚本部署本站。以上值的机器可读版本位于 `scripts/llm-hub/production-target.json`。

### 唯一源码入口

本机当前唯一允许编辑和发布 LLM-Hub 的工作树是：

```text
D:\xllm-xhs-post\projects\llmhub-loop-http400
```

`D:\code\llm-hub` 等其他副本不属于发布链路，只能作为归档或只读参考。发布脚本要求仓库内存在并匹配 `scripts/llm-hub/production-source.json`；缺少该标记的旧副本会在上传或构建前直接拒绝。修改前先确认当前路径、分支、origin 和目标清单，不凭对话记忆判断目标。

旧副本要完整归档，不删除、不覆盖；归档目录需要保留日期和原路径说明。`x-llm` 仍是另一套独立生产服务，不得因为 LLM-Hub 归档或发布而修改。

目标机地址、主机名、部署标识、目标清单、PowerShell 校验和服务器端校验脚本必须保持一致。发布脚本在上传任何文件前通过 SSH 连接地址、主机名和部署标识校验目标，不能通过修改 SSH 别名或绕过校验发布到其他服务器。

## 应用发布入口

## 最小发布标准

LLM-Hub 后续只按以下四条执行，不使用临时源码快照发布：

1. 功能在独立分支开发，完成后合并到 `main`；`main` 是唯一发布源。
2. 发布必须指定 `main` 上的明确提交，从该提交生成源码包和镜像；禁止发布未提交修改或手工复制目录。
3. 构建前后的业务回归测试必须通过，至少包括财务分账、路由和权限相关测试；版本号、容器健康和 `/api/status` 不能替代业务测试。
4. 发布前备份并准备回滚；只有得到明确确认后才替换线上容器。

发布编号继续使用 `llmhub-<提交短SHA>-<YYYYMMDD>-<序号>`，用于关联提交、源码包和镜像，不额外创建 `llmhub-*` Git 标签。

生产应用版本发布只能通过仓库内的 PowerShell 脚本执行：

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

## 基础设施变更

Compose 和 Caddy 不随应用镜像自动覆盖。修改 `scripts/llm-hub/production/compose.yml` 或 `scripts/llm-hub/caddy/Caddyfile` 时，必须先提交并审查，再将候选文件上传到目标机临时路径，分别执行 Compose 配置校验和 Caddy 配置校验；校验通过后安装到 `/opt/llm-hub`。Caddy 变更只重建 `caddy` 服务，数据库或 Redis 镜像变更必须单独安排并核对命名卷。

应用发布脚本会从 `-Commit` 指定的 Git 提交提取 Compose、Caddyfile 并比较远端 SHA-256；不读取工作区文件，也不受 Windows 换行符转换影响。存在漂移时拒绝继续。它还会检查根域名、`app`、固定 CNAME 接入点、随机通配子域名和 `343246113.xyz` 的状态接口及版本。

## 强制校验

脚本在每个阶段重新检查：

1. 当前仓库根目录和 `origin` 必须是 `x-llm-net/llmhub-radar`。
2. 所有已跟踪文件必须干净；构建只使用指定提交的 `git archive`，不打包工作区临时文件。
3. 版本中的提交短哈希必须与实际构建提交一致。
4. SSH 别名、远端主机名、compose 文件、compose 项目、服务、容器和镜像前缀必须全部匹配目标清单。
5. 生产 compose 中不得出现旧 X-LLM 或 GHCR 镜像。
6. 新镜像先使用临时 SQLite 启动，再对生产 MySQL 执行一致性只读备份，把快照导入隔离的临时 MySQL 8.4 容器，完整执行迁移并通过 `/api/status`；随后启动上一镜像并核对渠道商 `id / tenant_id / slug` 未被改写。预检不在生产数据库执行迁移或写入，也不开放公网端口。
7. 切换前必须成功查询并确认没有待执行或运行中的渠道测试、供给探测任务；查询失败或返回异常值时拒绝发布。随后备份 MySQL、`.env` 和 compose，并给旧镜像添加回滚标签。
8. 构建解包后必须通过 `assert-financial-features.sh`，并在 Docker 的 Go 构建阶段通过 `model`、`relay/helper`、`service`、`controller` 财务回归测试；任一关键业务能力缺失或测试失败都不得生成镜像。
9. `Deploy` 和 `Rollback` 没有 `-ConfirmProductionSwitch` 时直接拒绝执行。

构建门禁保护的是业务契约：租户费率字段和解析接口、供给价格快照中的租户费率、选路到计费的费率传递、收益记录与总代汇总，以及“总代费率覆盖优先于全局默认”的回归测试。版本号、容器健康和 `/api/status` 只能证明程序启动，不能替代这些业务检查。

## 上线前复盘闸门

2026-08-24 已完成四路只读复盘，覆盖租户与权限、路由与健康、计费与收益、发布与生产安全。复盘没有修改代码；上线前仍按以下闸门执行：

- [x] 数据库资格查询失败时，数据库直查选路改为失败关闭，不再把未过滤的 Channel 候选继续送入路由；同时保留定向回归测试。
- [x] `TrustQuota` 按 New API 现有行为保留，不另行关闭或重做预扣规则。它允许部分请求先完成、再按实际用量结算；余额出现负数时沿用 New API 的现有处理方式。该行为需要监控，但不作为本轮代码阻断项。
- [x] 业务确认一个渠道商只能归属一个总代理。当前 `HubProvider.tenant_id` 是单值归属，渠道、收益、提现和权限均沿该归属计算；不引入渠道商多租户关联或入口/服务双归属。
- [x] 新建渠道商入口要求可信总代 Host 上下文，并由服务端写入明确的 `HubProvider.tenant_id`；管理员创建入口同样要求当前租户或超级管理员明确选择目标租户。
- [x] 两层分账按万分比快照：渠道商服务费率默认 `1000 = 10%`，平台抽成率默认 `3000 = 30%`，平台只从总代理毛收入中抽取；新账单的四项收入之和必须等于用户实际扣费。
- [x] 分账兼容旧数据：`tenant_id IS NULL` 的历史渠道继续走旧解释；已归属总代理的新请求保存 `tenant_id`、两层费率和 `settlement_version = 2`，配置修改不回算历史账单。
- [x] 兜底引流佣金仍从实际服务渠道商收入扣除，不与平台代理抽成重复计算；失败尝试不生成收益。
- [x] 采用全新空库初始化，不存在需要迁移的 `HubProvider.tenant_id IS NULL` 历史数据；首批业务数据从零创建并验证归属。
- [x] 使用独立 MySQL、Redis、Caddy、网络和命名卷，并完成 Caddy/DNS/TLS 生产核验；代码测试不能替代后续真实计费与分账验收。

上述入口核验只证明目标清单中的根域和平台通配域名可用，不自动证明每个自定义总代理的渠道商子域可用。新增总代理根域时必须分别验证：

1. 根域 DNS 指向 LLM-Hub 入口并能访问 `/api/status`。
2. `*.<tenant-root>` DNS 已解析到同一入口；只配置根域记录不够。
3. DNS-only 接入时，Caddy 的公网信任证书覆盖根域及一级子域；不要把 Cloudflare Origin CA 证书用于直接公网访问。
4. 使用真实渠道商 slug 请求 `/api/hub/public/providers/<slug>`，确认返回该租户下的 Provider，而不是只检查根域首页。

平台固定接入点 `edge.llm-hub.store` 必须保持 DNS-only，并由一条平台侧 A 记录指向当前入口；总代理只引用这个稳定名称，不应在自己的 DNS 中记录 LLM-Hub 源站 IP。

2026-08-28 的线上核验中，`343246113.xyz` 根域正常，应用使用 `Host: x.343246113.xyz` 时正确返回 Provider 4；但公网 `x.343246113.xyz` 尚无 DNS，且当前 Caddy 只配置了 `*.llm-hub.store` 的通配源站证书。因此该自定义域名的渠道商公网入口仍是独立的基础设施待办，不应由应用发布脚本报告为已完成。

新增总代理按 [tenant-onboarding-runbook.md](tenant-onboarding-runbook.md) 执行，并使用 `scripts/Test-LlmHubTenantDomain.ps1` 做可重复验收。

计费信任额度和渠道商单一归属已按当前业务规则接受。初始化后仍需用新建数据完成一次真实请求、计费、两层分账、转余额和提现闭环。

## 回滚

从修改生产镜像标签开始，到容器健康、内部状态、远端版本和目标清单中的公网入口验证全部通过为止，任一步失败都会恢复备份的 Compose、`.env` 和旧镜像，并等待旧版本重新健康。Prepare 还会预先验证旧镜像能在新版本迁移后的临时数据库上启动。若部署后功能验收失败，使用同一版本号回滚：

```powershell
.\scripts\Release-LlmHub.ps1 `
  -Action Rollback `
  -Commit HEAD `
  -ReleaseTag llmhub-abcdef0-20260815-1 `
  -ConfirmProductionSwitch
```

回滚优先恢复上一镜像及其 Compose、`.env`，不还原数据库，但前提是目标镜像明确支持“渠道商 slug 在租户内唯一”，或者当前数据库不存在跨租户复用的 slug。PowerShell 总编排层始终在启动旧镜像前检查；从本次修改之后构建的 release，其版本化服务器脚本也会二次检查。手工回滚被阻断时不会修改 `.env`、Compose 或当前容器。部署失败后的自动恢复若被阻断，会保留当时的新版本尝试状态供人工处理，但不会启动不兼容旧镜像或继续改写数据库。

若旧镜像不兼容且必须回退，只能在人工评估后同时恢复对应的 MySQL 备份。恢复数据库会丢失发布后的新增和修改数据，不能作为自动回滚动作。仅能健康启动不代表 schema 兼容，预检还会比较旧镜像启动前后的渠道商归属和 slug。

## 入口访问日志

生产 Caddy 配置由 `scripts/llm-hub/caddy/Caddyfile` 管理。根域名和渠道商通配域名都写入 JSON 访问日志：

```text
/opt/llm-hub/logs/caddy/llm-hub-access.json
```

日志只包含请求元数据、Cloudflare 请求头、HTTP 状态码、Caddy 到应用的耗时和应用返回的 `X-Oneapi-Request-Id`，不记录请求体、Authorization 或上游密钥。文件按 100 MiB 轮转，保留 7 个文件或 7 天。

排查入口 522 时，先按截图时间查询该文件：

```bash
sudo grep 'x-llm.llm-hub.store' /opt/llm-hub/logs/caddy/llm-hub-access.json
```

如果 Cloudflare 显示 522 但 Caddy 没有对应记录，说明请求没有到达源站；如果有记录，则结合 `status`、`duration` 和 `X-Oneapi-Request-Id` 查询容器日志及后台请求日志。

## 事故记录

2026-08-15 曾在核验实际生产目标前推送 `xllm-*` Git 标签，误触发上游 Docker Hub 和通用二进制 Release 工作流。该流程没有替换生产容器，但暴露出发布目标依赖对话记忆的问题。本文件、目标清单、发布脚本和工作流排除规则共同作为后续防线。
