# LLMHub Radar Code Map

日期：2026-06-23

本文件记录 OpenStatus fork 中与 LLMHub Radar v0 最相关的代码入口。后续改 LLM monitor 时，先看这些位置。

## Workspace

- Root package: `package.json`
- Workspace config: `pnpm-workspace.yaml`
- Dashboard app: `apps/dashboard`
- Public status page app: `apps/status-page`
- API server: `apps/server`
- Go checker service: `apps/checker`
- Database schema: `packages/db`
- Product services: `packages/services`
- Email package: `packages/emails`

## Monitor Schema

Primary files:

- `packages/db/src/schema/monitors/constants.ts`
- `packages/db/src/schema/monitors/monitor.ts`
- `packages/db/src/schema/monitors/validation.ts`
- `packages/services/src/monitor/schemas.ts`
- `packages/services/src/monitor/create.ts`
- `packages/services/src/monitor/update.ts`
- `packages/services/src/monitor/list.ts`

Current monitor types are driven by `jobType`. Existing code paths mainly handle:

- `http`
- `tcp`
- `dns`

Likely LLM extension path:

1. Add an `llm` monitor type or add LLM-specific subtype fields while keeping `http`.
2. Prefer a distinct `llm` job type for clarity, because LLM checks have different payload, metrics, errors, and status semantics.
3. Add LLM-specific configuration fields in a separate table if the existing `monitor` table becomes too crowded.

## Checker Flow

Primary files:

- `apps/checker/cmd/server/main.go`
- `apps/checker/request/request.go`
- `apps/checker/checker/http.go`
- `apps/checker/checker/tcp.go`
- `apps/checker/checker/dns.go`
- `apps/checker/handlers/ping.go`
- `apps/checker/handlers/tcp.go`
- `apps/checker/handlers/dns.go`
- `apps/server/src/libs/checker/utils.ts`
- `apps/server/src/routes/v1/monitors/run/post.ts`
- `apps/server/src/routes/v1/monitors/trigger/post.ts`

Likely LLM extension path:

1. Add checker request/response structs for LLM.
2. Add `POST /checker/llm` in the Go checker.
3. Implement LLM probe adapter for OpenAI-compatible APIs.
4. Measure:
   - first byte
   - first token
   - total latency
   - stream success
   - token counts where available
   - normalized error type
5. Extend server-side checker payload builder to route `jobType = "llm"` to `/checker/llm`.

## API Routes

Primary files:

- `apps/server/src/routes/v1/monitors/schema.ts`
- `apps/server/src/routes/v1/monitors/post.ts`
- `apps/server/src/routes/v1/monitors/post_http.ts`
- `apps/server/src/routes/v1/monitors/post_tcp.ts`
- `apps/server/src/routes/v1/monitors/post_dns.ts`
- `apps/server/src/routes/v1/monitors/put.ts`
- `apps/server/src/routes/rpc/handlers/monitor/index.ts`

Likely LLM extension path:

1. Add REST schema for LLM monitor creation/update.
2. Add RPC handler support if dashboard uses RPC for monitor create/update.
3. Keep validation strict:
   - base URL required
   - model required
   - endpoint type required
   - API key must never be returned in read responses

## Notifications

Primary files:

- `packages/db/src/schema/notifications/constants.ts`
- `packages/db/src/schema/notifications/notification.ts`
- `packages/db/src/schema/notifications/validation.ts`
- `apps/server/src/routes/v1/notifications/*`
- `packages/emails/src/client.tsx`
- `packages/emails/src/send.ts`

Existing notification providers include email and webhook. Keep existing providers from the OpenStatus fork unless they create deployment burden.

## Public Status Pages

Primary files:

- `apps/status-page`
- `apps/server/src/routes/public/status.test.ts`
- `packages/db/src/schema/pages`
- `packages/db/src/schema/page_components`
- `packages/db/src/schema/shared.ts`
- `packages/services/src/page-component`
- `packages/services/src/page-subscriber`

LLM-specific public page rules:

1. Do not expose API keys.
2. Do not expose base URL by default.
3. Show model/channel display name, current status, sample window, success rate, p95 first-token latency, and recent incidents.
4. Allow `hidden`, `masked`, and `public` base URL visibility later.

## Reference Projects

Reference repositories are outside this fork:

- `../references/opensource/litellm`
- `../references/opensource/helicone`
- `../references/opensource/langfuse`
- `../references/opensource/gatus`
- `../references/opensource/uptime-kuma`
- `../references/opensource/kener`
- `../references/opensource/tianji`
- `../references/opensource/checkmate`

Immediate lookup targets:

1. LiteLLM provider and health check logic.
2. Helicone latency/cost/error recording.
3. Gatus alert condition model.
4. Uptime Kuma notification channel patterns.
