# LLMHub Radar v0 Product And Technical Design

Date: 2026-06-23

## 1. Product Positioning

LLMHub Radar is a model availability and status-page product for LLM API providers, relay operators, and channel vendors.

The first valuable use case is not a public benchmark. It is a trust page for channel vendors:

```text
My customers should be able to open one status URL and see which models are available,
which ones are degraded, and whether recovery is already being tracked.
```

The product should reduce repeated support communication in QQ/WeChat groups, make unstable low-cost channels easier to explain, and give providers a neutral public page they can share.

Recommended product language:

- Product name: `LLMHub Radar`
- Chinese module name: `通道雷达`
- English module name: `Relay Radar`
- Core object: `监控池`
- Public object: `状态页`

`x-llm.net` can use Radar as its own sample status page, but Radar should be positioned as an objective monitoring tool rather than an x-llm.net advertisement.

## 2. Core Decision

Private monitoring pools are part of v0.

Earlier discussion considered starting with a public pool only. The updated decision is:

1. Each workspace can create its own monitoring pool.
2. A monitoring pool can contain private base URLs and multiple API keys.
3. Each key can represent a billing group, model group, customer tier, or upstream quota bucket.
4. Radar only uses these keys for configured monitoring probes.
5. Each workspace can publish a status page and share it with customers.
6. Whether a page or aggregate data enters a public pool is explicit opt-in.

This is the main commercial use case. A provider like Skyhope can publish one page and let customers subscribe to model status updates instead of repeatedly explaining instability in group chats.

Confirmed decisions on 2026-06-24:

1. v0 public pages use `llm-hub.store/{slug}` first. Subdomains can come later.
2. Skyhope is displayed as a `named provider`, not as an official partner badge.
3. Normal verified users can create public pages. v0 should not be beta-only.
4. Public pages should grow first. Grouping, ranking, certification, and public-pool monetization are later decisions.
5. Probe frequency should not become a detailed user-facing configuration in v0. Use simple backend defaults and hard limits.
6. Automatic probe switches, manual test centers, batch test dialogs, and detailed reliability tuning are not v0 core UX.
7. "Open" means product access is open, not resource usage is unlimited. The backend still needs quota, cost, notification, and anti-abuse guardrails.

## 3. Non Goals

v0 should not become a generic proxy, router, or benchmark platform.

Do not do these in v0:

- API traffic forwarding.
- Automatic upstream switching.
- Public channel ranking.
- Full benchmark scoring.
- Arbitrary prompt testing.
- Full provider protocol matrix.
- Complex SLA contracts.
- Detailed billing reconciliation.
- Complex monitoring-control-center UX.
- User-facing cron/frequency tuning.
- Standalone batch manual-test center.
- Automatic key disable/delete flows.
- Public exposure of private base URLs or keys.
- Storing full prompt or response bodies.

## 4. Reusing OpenStatus

OpenStatus remains the correct fork base because it already has:

- Account and workspace foundation.
- Public status pages.
- Page components and grouping.
- Incident and maintenance flows.
- Subscriber and notification flows.
- Domain and slug based distribution.
- Dashboard and public status-page UI patterns.

However, LLM monitoring should not be forced into the existing generic `monitor` table as the source of truth.

Recommended architecture:

```text
OpenStatus
  - status pages
  - subscribers
  - incidents / maintenances / reports
  - public page rendering
  - notification foundation

LLMHub Radar
  - monitoring pools
  - providers / base URLs
  - credentials / key groups
  - provider models
  - probe targets
  - probe runs
  - aggregated metrics
  - trust and audit controls
```

OpenStatus can be the display and notification shell. Radar owns the LLM-specific domain model and probe execution.

## 5. Domain Model

### Monitoring Pool

A monitoring pool belongs to one workspace and represents a set of LLM endpoints the operator wants to monitor and publish.

Fields:

- `id`
- `workspace_id`
- `name`
- `slug`
- `description`
- `visibility`: `private`, `unlisted`, `public`
- `public_pool_opt_in`
- `created_at`
- `updated_at`

Example pools:

- `Skyhope Model Status`
- `x-llm.net Upstream Radar`
- `Claude Code Low Cost Group`

### Provider

A provider represents one private or public base URL.

Fields:

- `id`
- `workspace_id`
- `pool_id`
- `name`
- `display_name`
- `base_url_encrypted` or protected storage reference
- `base_url_host_hash`
- `base_url_visibility`: `hidden`, `masked`, `public`
- `provider_type`: `openai_compatible`, `anthropic_compatible`, `custom`
- `enabled`
- `notes`
- `created_at`
- `updated_at`

Default public behavior: hide the real base URL. Show only `display_name`.

### Credential

A credential is an API key under a provider. It is execution infrastructure, not a public page entity.

Fields:

- `id`
- `workspace_id`
- `provider_id`
- `name`
- `description`
- `encrypted_api_key`
- `key_fingerprint`
- `last_four`
- `billing_group`
- `model_group`
- `daily_probe_limit`
- `daily_token_limit`
- `daily_cost_limit`
- `enabled`
- `last_used_at`
- `created_at`
- `updated_at`

Recommended UX: ask users to create a dedicated low-quota monitoring key, not reuse production keys.

### Probe Target

A probe target is the real monitoring object. Public status should normally show target/model health, not key health.

Recommended v0 target granularity:

```text
provider + model_name + endpoint_type
```

Fields:

- `id`
- `workspace_id`
- `pool_id`
- `provider_id`
- `name`
- `display_name`
- `model_name`
- `endpoint_type`: `chat_completions` in v0
- `interval_seconds`
- `timeout_ms`
- `max_tokens`
- `stream_enabled`
- `enabled`
- `status_policy`
- `current_status`: `unknown`, `operational`, `degraded`, `down`, `paused`, `configuration_error`
- `created_at`
- `updated_at`

Do not make `provider + key + model` the public page object. It leaks internal grouping and makes pages noisy.

`provider_model` and `probe_profile` can be introduced later. v0 can keep model name and endpoint type directly on the target.

### Probe Profile

v0 should ship with one fixed profile and not expose it as a complex UI setting:

- OpenAI-compatible `POST /v1/chat/completions`
- Fixed prompt: `Reply with exactly: ok`
- `temperature: 0`
- `max_tokens: 1-8`
- `stream: true` when measuring first token
- Request timeout: 15-30 seconds

Later profiles:

- Non-stream chat availability.
- Responses API.
- Embeddings.
- Low-frequency image generation.
- Audio/transcription.

### Probe Run

Probe runs are append-only facts.

Fields:

- `id`
- `workspace_id`
- `pool_id`
- `target_id`
- `provider_id`
- `model_id`
- `credential_id_hash`
- `region`
- `started_at`
- `finished_at`
- `success`
- `http_status`
- `error_type`
- `safe_error_summary`
- `ttfb_ms`
- `first_token_ms`
- `total_latency_ms`
- `tokens_in`
- `tokens_out`
- `tokens_per_second`
- `estimated_cost`
- `prompt_template_version`
- `response_sample_hash`
- `trace_id`
- `created_at`

Do not store full request headers, API keys, full prompts, or full responses.

### Aggregated Metrics

Public pages should read aggregated metrics, not raw probe tables.

Fields:

- `id`
- `workspace_id`
- `target_id`
- `window`: `1h`, `24h`, `7d`, `30d`
- `sample_count`
- `success_rate`
- `p50_first_token_ms`
- `p95_first_token_ms`
- `p50_total_latency_ms`
- `p95_total_latency_ms`
- `error_rate`
- `error_count_by_type`
- `last_check_at`
- `last_success_at`
- `last_failure_at`
- `current_status`
- `updated_at`

v0 can compute these on demand for low volume, then move to periodic aggregation.

For first implementation, these values can also live in a compact `radar_target_status` table instead of a fully generic aggregate table.

## 6. Probe Strategy

v0 should be conservative.

Defaults:

- Default probes: every 5-10 minutes by backend policy.
- Critical official demo targets can run more frequently if needed.
- High-cost models: 15-60 minutes, opt-in only.
- Images/audio: disabled by default or very low frequency.
- Failure confirmation: retry once with short delay.
- Recovery confirmation: require 2 successful probes.
- Down status: require 2-3 consecutive failures, except clear configuration errors.

Do not expose detailed cron/frequency controls in v0. Keep `interval_seconds` internally for future plans and operational overrides.

Status classification:

- `operational`: recent probes healthy.
- `degraded`: partial failures or slow first token.
- `down`: repeated failures.
- `configuration_error`: auth/quota/model configuration errors.
- `unknown`: insufficient samples.
- `paused`: user disabled monitoring.

Error taxonomy:

- `auth_error`
- `rate_limited`
- `insufficient_quota`
- `model_not_found`
- `timeout`
- `server_error`
- `network_error`
- `bad_response`
- `empty_stream`
- `content_filter`
- `unknown`

TTFT accuracy note: only streaming probes can measure first token. Non-stream probes should not be labeled as first-token latency.

## 7. Public Status Page

Each monitoring pool can generate a shareable status page:

```text
https://llm-hub.store/{slug}
https://{slug}.llm-hub.store
https://status.customer.com
```

Recommended priority:

1. v0 fallback: `llm-hub.store/{slug}`
2. Preferred platform distribution: `{slug}.llm-hub.store`
3. Paid/custom: `status.customer.com`

Public page should show:

- Overall current status.
- Model or group status.
- Last checked time.
- 24h / 7d availability.
- p50 / p95 first-token latency if enabled.
- Recent error type, aggregated.
- Incident timeline.
- Email subscription.
- Data source disclaimer.

Public page should not show by default:

- API key or key suffix.
- Full base URL.
- Raw headers.
- Raw upstream response body.
- Internal provider notes.
- Exact per-run timestamps if they reveal sensitive routing behavior.
- Balance, quota, pricing, or customer group internals.

Base URL visibility levels:

| Visibility | Public Display | Use Case |
| --- | --- | --- |
| `hidden` | User-defined display name only | Default for private operators |
| `masked` | Partially masked host | Controlled transparency |
| `public` | Full provider name or URL | Official provider/demo opt-in |

## 8. Internal Dashboard

The dashboard should help the operator answer within 10 seconds:

```text
Which provider/model is unhealthy, why, and should I notify customers?
```

v0 dashboard sections:

- Pool overview.
- Providers/base URLs.
- Credentials/key groups.
- Models.
- Probe targets.
- Recent probe runs.
- Active incidents.
- Public page preview.
- Subscriber count.
- Trust/audit page.

Monitoring table columns:

- Status.
- Display name.
- Provider.
- Model.
- Endpoint type.
- Last checked.
- 1h success rate.
- 24h success rate.
- p95 first token.
- Error type.
- Sample count.
- Notifications enabled.
- Actions.

Detail page:

- Success-rate chart.
- p50/p95 first-token chart.
- Total latency chart.
- Error type distribution.
- Recent failures.
- Incident timeline.
- Probe configuration.
- Audit log.

Curves are useful, but they should not dominate the first screen. The first screen should be a scan-friendly status list with small sparklines.

## 9. Public Pool And Monetization

Public pool inclusion is opt-in.

Recommended public pool levels:

- Not listed: private status page only.
- Listed anonymous aggregate: no provider base URL, only model-level status.
- Listed named provider: brand/name visible.
- Certified provider: provider verified, gets badge and richer page.

Potential paid boundaries:

- More monitoring pools.
- More models.
- Higher probe frequency.
- Longer history.
- Custom domain.
- White label.
- More subscribers.
- Webhooks and advanced notifications.
- Detailed error and latency visibility.
- Public pool certification badge.
- Weekly/monthly availability reports.
- Multi-customer pages.

Do not lead with a public ranking. Ranking creates data quality disputes, gaming incentives, and commercial conflict. Use neutral language such as `observed results`, `recently stable`, `recently degraded`, and `sample size`.

## 10. Trust And Security Commitments

Trust should be implemented as product behavior, not just copy.

Required v0 trust controls:

- API keys encrypted at rest.
- Never return full key to the client after creation.
- Show key fingerprint and last four only.
- Recommend dedicated low-quota monitoring keys.
- Fixed low-cost probe templates.
- Daily probe/token/cost limits per credential.
- One-click pause.
- One-click delete.
- Key rotation.
- User-visible usage/audit log.
- Log redaction for headers, keys, and response bodies.
- Public page data minimization.
- SSRF protection for base URLs.
- Rate limits for manual probes.

Recommended public commitment:

```text
Radar uses the monitoring API key you configure only to send low-cost health probes
to the specified base URL and model at the frequency you choose. We do not use that
key for platform traffic forwarding, other users' requests, or non-monitoring use.
Each probe creates an audit record showing time, model, status, latency, and estimated
usage. You can pause, delete, or rotate the key at any time.
```

Avoid absolute claims:

- Do not say the platform can never access the key if server-side probing decrypts it.
- Do not claim zero cost.
- Do not claim no data is stored.
- Do not claim 100% security.
- Do not claim public pages leak no information.

## 11. Backend Guardrails

v0 should be open for normal users, but not unlimited.

These controls do not need complex UI in v0, but they should exist in backend policy:

- Email verification before publishing a public page.
- Per-account pool limit.
- Per-pool target/model limit.
- Per-account daily probe limit.
- Per-credential daily probe/token limit.
- Per-page subscriber limit.
- Probe backoff during repeated failures.
- Notification deduplication and unsubscribe links.
- Public slug reserved words and length rules.
- Page name/description length limits.
- Base URL SSRF protection:
  - block localhost
  - block private IP ranges
  - block metadata endpoints
  - block raw IPs if possible
  - re-check resolved IP at request time
- Public pages default to hidden base URL and no raw error body.
- Admin can unpublish a page or suspend an abusive account.

This keeps the product entry open while preventing Radar from becoming a free key validator, public-page spam farm, or notification flooder.

## 12. UX Flow

### Channel Vendor

1. Register and create workspace.
2. Create a monitoring pool.
3. Add provider/base URL.
4. Add one or more monitoring keys.
5. Select models to monitor.
6. Run manual test.
7. Review sensitive data visibility.
8. Publish status page.
9. Configure email/webhook alerts.
10. Share status page with customers.
11. Manage incidents and recovery notes.

### Customer

1. Open the vendor's status page.
2. Check model availability.
3. Subscribe by email.
4. Receive incident and recovery notifications.
5. Stop repeatedly asking in group chat whether the provider is down.

## 13. Reference Projects To Review

Local reference projects:

- `C:\Users\keke.qiu\xllm-xhs-post\references\opensource\openstatus`
- `C:\Users\keke.qiu\xllm-xhs-post\references\opensource\litellm`
- `C:\Users\keke.qiu\xllm-xhs-post\references\opensource\helicone`
- `C:\Users\keke.qiu\xllm-xhs-post\references\opensource\langfuse`
- `C:\Users\keke.qiu\xllm-xhs-post\references\opensource\gatus`
- `C:\Users\keke.qiu\xllm-xhs-post\references\opensource\uptime-kuma`
- `C:\Users\keke.qiu\xllm-xhs-post\references\opensource\kener`
- `C:\Users\keke.qiu\xllm-xhs-post\references\opensource\tianji`
- `C:\Users\keke.qiu\xllm-xhs-post\references\opensource\checkmate`
- `D:\code\new-api-rc14-review`

Use references for ideas and interaction patterns. Do not copy code without license review and source attribution.

## 14. Reference Adoption Decisions

### Adopt For v0

From new-api:

- Channel health list pattern: status, model count, key count, last checked time, response time, and failure summary.
- Multi-key status idea: key usable, key failed, failure reason, failure time.
- Reliability concepts: timeout threshold, failure/recovery threshold, safe error classification.
- A simple `save and verify` action after creation. This is not a standalone manual-test center.

From LiteLLM:

- Endpoint-aware probe profiles. Chat, responses, embeddings, images, and audio should not share one request payload.
- Health-check-specific fields: health check model, timeout, max tokens, disable background health check.
- Provider/model configuration should describe how a model is probed, not just the model name.

From Helicone and Langfuse:

- Metric vocabulary: provider, model, mode, status code, latency, TTFT, token usage, estimated cost, started/ended timestamps.
- One probe may eventually have multiple attempts, but v0 should not build a full trace UI.

From Gatus/Kener/Checkmate:

- Explain status through condition results, not just red/green.
- Failure threshold and recovery threshold should prevent alert flapping.
- Status page should show current incident, historical incidents, heartbeat/status bars, and last updated time.

### Defer

- LiteLLM-style routing, fallback, cooldown, and traffic policy.
- Helicone/Langfuse-style full observability backend.
- Uptime Kuma-style large notification catalog.
- Kener badge/embed and deep theme customization.
- Multi-region probe network.
- Full trace UI with nested attempts.
- Standalone model batch-test dialog.
- Row-level quick-test actions across tables.
- Detailed reliability settings page.

### Reject For v0

- Inferring endpoint type from model name as the main path. Radar should ask users to choose the probe type explicitly.
- Treating `401` as provider outage. In Radar it is usually key/configuration failure until proven otherwise.
- Deleting failed models or disabled keys automatically.
- Exposing automatic probe switch as a core setup decision.
- Storing only last response time. Radar needs time-series probe facts.
- Putting API keys into OpenStatus `monitor.headers`.
- Extending OpenStatus `MONITOR_JOB_TYPES` with `llm` as the first implementation path.

## 15. Implementation Architecture

Recommended v0 route:

```text
Radar domain tables + Radar services + TS/Bun probe worker
  -> write probe runs and aggregates
  -> map aggregate status to OpenStatus shadow monitors
  -> reuse OpenStatus status pages and notifications
```

### Code Placement

Database:

- Add schema under `packages/db/src/schema/radar/`.
- Export through the existing schema index.
- Start with the minimal v0 tables:
  - `radar_pool`
  - `radar_provider`
  - `radar_credential`
  - `radar_probe_target`
  - `radar_probe_run`
  - `radar_target_status`
  - `radar_target_openstatus_binding`

Services:

- Add domain logic under `packages/services/src/radar/`.
- Keep credential redaction and key decryption centralized.

API:

- Add protected dashboard APIs under `packages/api/src/router/radar.ts`.
- Add public read APIs only for aggregate/status-page data.

Dashboard:

- Add pages under `apps/dashboard/src/app/(dashboard)/radar`.
- Do not overload existing HTTP/TCP/DNS monitor create/edit forms.

Worker:

- Prefer `apps/workflows/src/radar/` for v0.
- Do not start by extending the Go checker, because the existing checker is optimized for HTTP/TCP/DNS and Tinybird ping metrics.
- Use backend default scheduling rather than user-facing detailed frequency controls.

Status page bridge:

- Create a safe OpenStatus shadow monitor per public probe target.
- Use the shadow monitor name and page component for public page rendering.
- Never store real base URL or API key in the shadow monitor.
- Add Radar-specific aggregate panels later for TTFT and LLM metrics.

Notifications:

- Reuse existing email/webhook notification providers.
- Trigger notifications from Radar status transitions or shadow monitor state changes.

## 16. v0 Screen Plan

The first implementation should stay small. The goal is a user creating a shareable status page in roughly 10 minutes.

### Dashboard Pages

1. Radar pools list
   - Pool name
   - Public page status
   - Providers count
   - Models count
   - Active incidents
   - Last checked

2. Pool detail
   - Provider list
   - Credential/key groups
   - Model targets and current status
   - Current health summary
   - Public page preview

3. Create/edit pool
   - Pool name
   - Slug
   - Provider display name
   - Base URL
   - API key
   - Model names
   - Publish page toggle
   - Save and verify

4. Lightweight probe history
   - Latest runs
   - Status
   - Error type
   - TTFT
   - Total latency
   - Timestamp

5. Trust controls
   - Key fingerprint
   - Last key use
   - Delete key
   - Pause pool

Do not build these as v0 core pages:

- Automatic probe-switch page.
- Batch model test center.
- Detailed frequency/threshold tuning.
- Complex multi-key management dialog.
- Public ranking console.
- Custom-domain setup.
- Multi-customer grouping.
- Complex audit console.

### Public Page

- Overall status.
- Provider/model group list.
- Current status and last checked time.
- 24h / 7d availability.
- Small heartbeat/status bar.
- Optional p95 first-token latency.
- Current incident.
- Historical incidents.
- Email subscription.
- Data-source disclaimer.

## 17. Implementation Milestones

### Milestone 1: Internal Probe Loop

- Add minimal Radar domain schema.
- Add pool, provider, credential, target CRUD.
- Add encrypted credential storage.
- Add save-and-verify probe path.
- Record probe runs.
- Show pool detail, target list, and recent runs.

### Milestone 2: Scheduled Monitoring

- Add scheduler/worker.
- Add error normalization.
- Add status policy.
- Add lightweight target status aggregation.
- Add backend probe quotas and frequency limits.
- Add probe run audit trail.

### Milestone 3: Public Status Page

- Map probe targets to status page components.
- Add public page display for model status.
- Hide sensitive fields by default.
- Add subscriber flow.
- Add incident/recovery display.
- Allow normal verified users to publish pages.

### Milestone 4: Notifications

- Email incident notification.
- Email recovery notification.
- Webhook notification if the existing provider is straightforward to reuse.
- Basic deduplication and recovery notification.
- Subscriber management.

### Milestone 5: First Demo

- Build `Skyhope` demo pool as a named provider.
- Build `x-llm.net` upstream pool.
- Publish public page.
- Use the page in customer communication.

## 18. Open Questions And Current Answers

Questions to confirm before implementation:

1. Page URL: use `llm-hub.store/{slug}` in v0. Subdomains come later.
2. Skyhope display: use named provider, not official partner.
3. User-created public pages: allow normal verified users in v0.
4. High-cost endpoints: defer or disable by default.
5. Public pool listing: public pages can exist; public directory/ranking is not v0 core.
6. Webhook scope: defer detailed UX; reuse existing provider only if low effort.
7. Probe frequency: keep backend defaults and hard limits; do not expose detailed tuning in v0.

Still open:

1. Exact free-user hard limits: pools per account, targets per pool, subscribers per page, daily probes.
2. Email verification requirement before publishing public pages.
3. Public directory timing: whether to launch a simple directory at v0 or wait for real usage data.
4. Admin moderation UI: minimum page takedown and account suspension flow.

## 19. Current Recommendation

Ship v0 as:

```text
Private monitoring pool + low-cost real probes + public status page + email notification + backend guardrails.
```

This is enough to validate whether channel vendors will use Radar as their customer trust page. Public pool, certification, richer charts, custom domains, detailed probe tuning, and ranking can become paid expansion points after the first real users share their pages.

## 20. Implementation Status

Implemented on 2026-06-24:

- Added dedicated `radar_*` database tables and migration `0077_opposite_violations.sql`.
- Added service-layer create/list/get/record-probe primitives under `packages/services/src/radar`.
- Added tRPC dashboard router `radar` under the edge router.
- Added dashboard `/radar` pool list and creation flow.
- Added dashboard `/radar/[id]` pool detail view with provider, credential fingerprint, target status, and trust controls.
- Added worker-side OpenAI-compatible probe skeleton with TTFT, TTFB, latency, token usage, error classification, redaction, SSRF URL checks, and status policy tests.
- Added Radar notification event table and v0 notification loop:
  - status transition detection runs after probe aggregation.
  - degraded notifications wait for a repeated degraded state.
  - down, configuration issue, and recovery transitions enqueue events.
  - pending events reuse existing OpenStatus page subscriber email/webhook dispatch.
  - delivery status is persisted as pending, sent, failed, or skipped.

Launch readiness TODO as of 2026-06-24:

- Productionize the Radar worker: run it as a deployable long-running service or scheduled job with health logs, restart behavior, and a clear owner.
- Add hard v0 guardrails: status pages per account, API keys per page, probe targets per page, daily probes, subscribers per page, and webhook delivery retries.
- Tighten auth and onboarding: make registration visible, keep login sessions stable, and verify the dashboard redirect flow.
- Add public trust copy: API keys are used only for health probes, not traffic forwarding; Base URL and full keys stay hidden.
- Remove or internalize `radar.recordProbeRun` from the dashboard-facing tRPC router before production. Probe results should be written by the worker, not arbitrary client calls.
- Add a minimal admin safety path: unpublish abusive public pages and suspend obvious spam accounts.
- Add a smoke-test script covering create status page -> add API key -> discover models -> scheduled probe -> public page -> subscribe -> notification.
- Decide whether generic JSON webhooks should be enabled for public subscribers, or kept as vendor-added Slack/Discord webhooks only.

Verification:

- `pnpm --filter @openstatus/dashboard tsc` passes.
- `pnpm --filter @openstatus/services test src/radar/notification-policy.test.ts` passes.
- `pnpm --filter @openstatus/workflows exec bun test src/radar/radar.test.ts` passes.
- `pnpm --filter @openstatus/services tsc` is blocked by an existing `packages/db/src/db.ts` declaration issue for `../env.mjs`.
- Full workflows typecheck is blocked by existing non-Radar issues in `apps/workflows/src/cron/external-status.ts` and the same `db/env.mjs` declaration issue.
