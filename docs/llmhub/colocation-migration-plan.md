# LLM-Hub 专用主机初始化记录

## 最终决策

`ssh llm-hub` 是 LLM-Hub 的专用生产主机，`ssh x-llm` 是另一套仍在运行的 X-LLM 生产服务。两者不得共享发布脚本、Compose 项目、数据库、Redis、镜像名称或部署目录。

本次不迁移任何历史 LLM-Hub 数据。LLM-Hub 使用全新 MySQL、Redis 和空业务库启动，管理员、租户、渠道商、渠道、模型定价和结算配置均从零创建并作为上线验收的一部分。

## 主机与服务

| 项目 | 值 |
| --- | --- |
| SSH 目标 | `llm-hub` |
| 主机名 | `llm-hub` |
| 地址 | `159.195.18.119` |
| 部署目录 | `/opt/llm-hub` |
| Compose 项目 | `llm-hub` |
| 部署标识 | `llm-hub-store-production-v2` |
| 应用容器 | `llm-hub-new-api` |
| 数据库 / Redis | `llm-hub-mysql` / `llm-hub-redis` |
| 入口 | `llm-hub-caddy` |

生产应用仅在主机 `127.0.0.1:3100` 暴露调试端口。公网 `80/443` 只由 LLM-Hub 自己的 Caddy 监听。

## 旧服务处理

目标机原有 New API 栈不是当前 X-LLM 线上服务。替换前已完成一致性备份并校验，备份位置为：

```text
/opt/backups/x-llm-net/pre-llmhub-colocation-20260825-120115
```

备份包含 MySQL、Redis、配置、证书、容器拓扑和 SHA-256 校验结果。旧目录已归档到：

```text
/opt/retired/x-llm-net-20260825
```

旧容器和网络已退役；旧命名卷暂时保留为额外恢复手段。该备份只用于防止本次主机替换误伤，不作为 LLM-Hub 数据源，也不会导入新库。

## TLS 与 DNS

- `llm-hub.store` 保持仅 DNS，由 Caddy 自动维护公开证书，减少 API 流式链路上的代理开销。
- `app.llm-hub.store` 与 `*.llm-hub.store` 保持 Cloudflare 代理，源站使用仅覆盖 `*.llm-hub.store` 的 Origin Certificate。
- `edge.llm-hub.store` 是总代理 CNAME 的固定目标，保持仅 DNS；它的 A 记录指向当前入口服务器，仅用于基础设施健康检查。
- `343246113.xyz` 保持 Cloudflare 代理，Caddy 已取得该域名的公开证书。
- 服务器更换时只修改 `edge.llm-hub.store` 的 A 记录；总代理侧的 CNAME 不需要调整。
- Caddy 反代必须保留 `flush_interval -1`，避免重新引入流式缓冲。

通配 Origin 私钥只保存在服务器：

```text
/opt/llm-hub/certs/llm-hub.store.key
```

证书文件为 `/opt/llm-hub/certs/llm-hub.store.pem`，不得提交到 Git 或输出到日志。

## 空库验收

首次启动必须满足：

1. MySQL、Redis、应用和 Caddy 容器均健康。
2. 数据迁移创建完整表结构，但 `users`、`channels`、`hub_providers` 均为 `0`。
3. `/api/status`、根页面、`app` 子域名、随机通配子域名和 `343246113.xyz` 可访问。
4. 公网应用版本与部署镜像标签一致。
5. 从零创建首个超级管理员后，再按业务验收清单创建租户、渠道商、渠道和定价；不导入历史业务记录。

## 恢复边界

初始化失败时只停止 `llm-hub` Compose 项目并修复新栈。不得连接、重启或发布 `ssh x-llm`。只有确认需要恢复目标机原有旧服务时，才使用上述备份或保留卷；这不属于 LLM-Hub 常规回滚流程。
