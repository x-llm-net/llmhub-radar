# 总代理开通标准流程

## 1. 目的与完成定义

新增总代理不是只创建一条 `Tenant` 记录。一次开通同时包含域名、DNS、TLS、反向代理、租户资料、Owner 权限和实际入口验收。

只有以下条件全部满足，才能标记为“已开通”：

1. 总代理域名符合首版约束，并由申请方控制。
2. 根域和随机一级子域都能从公网解析并通过 HTTPS 访问 LLM-Hub。
3. 根域被平台识别为正确租户，品牌数据不与其他租户串用。
4. 唯一 Owner 可以登录，并且只能管理本租户数据。
5. 至少使用一个真实渠道商 slug 验证 `{slug}.{tenant-root}` 命中正确 Provider。

## 2. 固定约束

- 总代理根域必须恰好由两个 DNS 标签组成，例如 `example.com`、`343246113.xyz`。
- 不接受 `sub.example.com`、`example.com.cn`、URL、端口、通配符或 IP。
- 渠道商地址固定为 `{slug}.{tenant-root}`，不增加第四层域名。
- 渠道商 slug 只要求在同一租户内唯一；不同总代理可以使用相同 slug。
- 每个租户只有一个 Owner。更换 Owner 时，先移除原 Owner，再设置新 Owner。
- 超级管理员拥有全平台权限；Owner 和租户 Admin 只拥有本租户权限。
- Cloudflare 和平台域名验证未完成前，域名保持 `pending`，不得提前标记为已验证。

## 3. 开通输入

开始前记录以下信息：

| 项目 | 要求 |
| --- | --- |
| 租户名称 | 对外显示的总代理名称 |
| 租户 slug | 平台内部稳定标识，不作为公开域名 |
| 根域名 | 严格两段，申请方可控制 DNS |
| Owner 用户 | 已存在的平台用户，记录 User ID 和用户名 |
| DNS 服务商 | 能配置根域和通配 DNS；Cloudflare 用户使用 DNS-only（灰云） |
| 品牌资料 | 品牌名称、Logo，可在基础设施验收后补充 |
| 验收渠道商 | 一个真实渠道商 slug，以及平台中的 Provider ID |

## 4. 阶段 A：域名与 Cloudflare

1. 确认域名所有权，并确认没有正在承载其他生产服务。
2. 在 Cloudflare 创建以下记录，统一使用仅 DNS（灰云）：

```text
@    CNAME    edge.llm-hub.store    DNS only
*    CNAME    edge.llm-hub.store    DNS only
```

如果 DNS 服务商不支持根域 CNAME，使用其 `ALIAS`、`ANAME` 或 CNAME flattening 能力；不要退回手填服务器 IP。

3. 这两条接入记录使用 DNS-only，Cloudflare 的边缘代理和 SSL/TLS 模式不参与这段链路。
4. 根域和 `*` 必须同时配置。只有 `tenant-root` 时，总代理首页可访问，但所有渠道商地址仍不可用。

总代理不需要申请、上传或安装证书。LLM-Hub 的 Caddy 已启用按需自动证书：首次访问已验证的总代理根域或渠道商子域时，Caddy 会自动申请并保存公网信任证书，之后自动续期。未登记、未验证、已停用的域名不会触发证书申请。

平台侧由 LLM-Hub 管理员维护一个固定接入记录：

```text
edge.llm-hub.store    A    159.195.18.119    DNS only
```

`edge.llm-hub.store` 是稳定 CNAME 目标，不是总代理的业务域名，也不能注册为渠道商 slug。未来换服务器时只修改平台侧这条 A 记录，所有总代理的 DNS 配置保持不变。它必须是灰云；总代理侧也使用灰云 CNAME，避免不同 Cloudflare 账户之间代理 CNAME 触发跨账号限制。

## 5. 阶段 B：Caddy 与会话配置

1. 平台固定使用 `scripts/llm-hub/caddy/Caddyfile` 中的按需 TLS 配置；新增总代理不需要修改 Caddyfile。

2. 将 `https://tenant-root` 加入生产 `.env` 的 `SESSION_COOKIE_TRUSTED_URL`。不加入 `*.tenant-root`；同源的渠道商子域会按请求 Host 校验。
3. 不修改 `SESSION_COOKIE_DOMAIN=llm-hub.store`。自定义总代理域名会自动使用 Host-only Refresh Cookie，浏览器不会收到无效的跨根域 Cookie。
4. 不修改 `HUB_PROVIDER_ROOT_DOMAIN=llm-hub.store`。它标识平台默认根域，不是“当前租户域名”；自定义总代理从 `tenant_domains` 解析。
5. 不要把每个总代理域名加入固定 Caddyfile 或生产健康检查清单；按需证书授权接口会根据数据库中的租户域名状态判断。
6. Caddy、目标清单和 `.env` 属于基础设施变更，不跟随普通应用镜像自动覆盖。先提交并审查候选文件，再在目标机执行配置校验和安装；`.env` 变化需要重建 `new-api` 容器，Caddyfile 变化只重建 Caddy。两者都不重启 MySQL 或 Redis。
7. Caddy 重载后先运行只读基础设施验收：

```powershell
.\scripts\Test-LlmHubTenantDomain.ps1 `
  -RootDomain tenant-root `
  -InfrastructureOnly
```

该模式只检查 DNS、HTTPS、线上版本和可信会话 Origin。自动证书模式下，正式域名还需要完成平台登记和验证，之后用根域和一个真实渠道商子域做首次访问验收。

## 6. 阶段 C：平台租户与角色

由超级管理员在“总代理管理”完成：

1. 创建租户，填写名称和内部 slug。
2. 添加根域，先保持未验证；不要填写 `*.`。
3. 基础设施验收通过后，将域名设为 `verified + active + primary`。
4. 设置唯一 Owner；需要其他运营人员时再添加 Admin。

5. 域名验证完成后，按以下地址验收自动证书：

```text
https://tenant-root
https://provider-slug.tenant-root
```

首次访问新地址可能因 ACME 申请证书增加几秒延迟；证书签发后再次访问应恢复正常速度。
6. 设置品牌名称和 Logo，并在该根域刷新确认。
7. 检查本租户默认渠道商服务费；平台对总代理毛利润的抽成仍使用平台全局配置，不在租户开通时另造一套费率。

## 7. 阶段 D：功能验收

### 7.1 根域验收

- `https://tenant-root/api/status` 返回当前线上版本。
- `https://tenant-root/api/hub/public/brand` 返回 `is_tenant_host=true` 和本租户品牌。
- Owner 可以登录、刷新页面和退出，不出现连续鉴权错误。
- Owner 只能看到本租户渠道商、渠道、日志、品牌和财务数据。
- 超级管理员在同一域名仍保留全平台权限和租户筛选。
- 当前生产 OAuth 和 Passkey 未开放时使用密码登录验收。未来启用 OAuth 或 Passkey 后，新增总代理还必须验证回调允许列表、OAuth state 返回原 Host、Passkey RP ID/origin；未通过时不能宣称该认证方式支持自定义域。

### 7.2 渠道商子域验收

创建或选择一个真实渠道商后执行：

```powershell
.\scripts\Test-LlmHubTenantDomain.ps1 `
  -RootDomain tenant-root `
  -ProviderSlug provider-slug `
  -ExpectedProviderId 123
```

脚本必须确认：

- 随机子域证明通配 DNS 和通配 TLS 生效，而不是只碰巧配置了一个 slug。
- 公开渠道商接口返回预期 Provider ID。
- `public_url` 精确等于 `https://provider-slug.tenant-root/`。

### 7.3 首个真实服务验收

总代理正式对外前，再用低额度测试 Key 完成一次真实请求，并记录 `request_id`：

- 请求从渠道商子域进入并命中预期渠道或按规则兜底。
- 消费日志中的入口租户、入口渠道商、实际渠道商和 Channel 正确。
- 用户扣费与渠道商收入、引流收益、平台收入、总代理净收入守恒。
- 测试结束后检查总代理财务汇总与对账状态正常。

## 8. 失败处理与下线顺序

开通失败时不要删除业务记录或直接改数据库：

1. 域名尚未验证：保持 `pending`，修复 DNS/TLS 后重试。
2. 已验证但出现串租户、权限或品牌问题：先停用该租户域名；严重时停用租户。
3. Caddy 或证书问题：恢复上一份已验证的 Caddyfile，不回滚应用数据库。
4. 下线总代理：先停用域名和租户，确认无请求和待结算资金，再删除 DNS；证书最后撤销或移除。
5. 不复用已停用租户的渠道商 slug 解释历史账单；账本仍按创建时快照保留。

## 9. 验收记录模板

```text
Tenant ID:
Tenant name / slug:
Root domain:
Owner user ID / username:
Cloudflare root DNS: PASS / FAIL
Cloudflare wildcard DNS: PASS / FAIL
Edge TLS: PASS / FAIL
Caddy origin TLS: PASS / FAIL
Tenant brand isolation: PASS / FAIL
Provider slug / expected ID: PASS / FAIL
Owner permission isolation: PASS / FAIL
Real request ID:
Billing reconciliation: PASS / FAIL
Completed by / completed at:
```
