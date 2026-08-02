# LLMHub Radar

LLMHub Radar is an open-source LLM API status page and channel monitoring platform.

This project is forked from [OpenStatus](https://github.com/openstatusHQ/openstatus) and keeps the AGPL-3.0 license. The first product goal is to extend OpenStatus from HTTP uptime monitoring into LLM-specific monitoring:

- OpenAI-compatible model checks
- streaming first-token latency
- endpoint-specific probes for chat, responses, embeddings, images, audio, and related APIs
- normalized LLM error categories
- public status pages for providers, teams, and API station owners
- email and webhook alerts

## Product Scope

The first version is intentionally narrow:

- Users can create a workspace.
- Users can create a public status page.
- Users can add LLM monitors with base URL, model name, API key, endpoint type, interval, timeout, and max tokens.
- The probe worker sends real low-cost requests and records success rate, first-token latency, total latency, token usage, and normalized errors.
- Public pages show objective status with sample size, time window, recent incidents, and update time.

The first version does not do API proxying, automatic routing, traffic switching, model quality scoring, or global channel rankings.

## Domain Plan

- Marketing site: `llm-hub.store`
- Dashboard: `app.llm-hub.store`
- API: `api.llm-hub.store`
- Preferred public pages: `{workspace}.llm-hub.store`
- MVP fallback public pages: `llm-hub.store/{slug}`

## Reference Documents

Project design lives in the parent workspace:

- `docs/LLMHUB_V2_DATA_MODEL.md`
- `../docs/llmhub-radar-tech-design.md`
- `docs/CODEMAP.md`
- `docs/SETUP_NOTES.md`

Downloaded reference repositories are indexed here:

- `../references/REFERENCE_INDEX.md`

## Upstream

This repository was initialized from OpenStatus. The remote named `upstream` points to the original OpenStatus repository for reference and future sync. Push to upstream is disabled locally.

```sh
git remote -v
```

## Deployment

Radar has a dedicated Docker compose file. Do not use the original upstream
OpenStatus compose as the production deployment line.

```sh
cp .env.radar.example .env.radar
docker compose -f docker-compose.radar.yaml up -d --build \
  libsql db-migrate dashboard status-page radar-probe-worker
```

Subscriber notifications are intentionally not started by the default command.
Run the preflight check first:

```sh
docker compose -f docker-compose.radar.yaml run --rm \
  radar-probe-worker bun src/scripts/radar-notification-preflight.ts
```

Then explicitly enable the notification worker:

```sh
docker compose -f docker-compose.radar.yaml --profile notifications up -d \
  radar-notification-worker
```

See `docs/LLMHUB_RADAR_DEPLOYMENT.md` for the full deploy checklist.

## Development

OpenStatus uses pnpm workspaces, Next.js, Hono, Go checker services, Turso/libSQL, Drizzle, Tinybird, and Tailwind.

Original OpenStatus quick start, kept only for upstream reference:

```sh
cp .env.docker.example .env.docker
docker compose up -d
```

Manual development generally requires:

- Node.js >= 20
- pnpm
- Bun
- Go
- Turso CLI for local database workflows

## License

AGPL-3.0, inherited from OpenStatus.
