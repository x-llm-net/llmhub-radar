# LLMHub Radar Deployment

This document defines the first Docker deployment line for LLMHub Radar. The goal is operational clarity: web apps, probes, and notification delivery must be independent so a redeploy does not accidentally replay old subscriber notifications.

For day-to-day product and UI iteration, use local hot reload instead of rebuilding Docker images. See `docs/LLMHUB_RADAR_LOCAL_DEVELOPMENT.md`.

## Services

| Service | Purpose | Public | Default |
| --- | --- | --- | --- |
| `dashboard` | owner dashboard, login, provider/API key management | yes | on |
| `status-page` | public provider status pages | yes | on |
| `radar-probe-worker` | scheduled LLM API probes | no | on |
| `radar-notification-worker` | email/webhook subscriber delivery | no | off |
| `libsql` | application database | no | on |
| `db-migrate` | one-shot database migration | no | on during deploy |

Do not merge `radar-probe-worker` and `radar-notification-worker`. Restarting probes must not send notifications.

## Docker Files

Radar uses dedicated deployment files instead of the old upstream OpenStatus compose:

```text
docker-compose.radar.yaml
docker-compose.radar.images.yaml
.env.radar.example
apps/radar-worker/Dockerfile
scripts/deploy-llmhub-radar.sh
```

The worker image runs the dashboard script entrypoints directly with Bun:

```bash
pnpm radar:cron
pnpm radar:notifications
pnpm radar:notifications:preflight
```

The Next.js standalone dashboard/status-page images are kept for web traffic only.

## GitHub Actions Release Line

The normal production release path is GitHub Actions based. The server should
pull prebuilt images instead of building Next.js and Docker images locally.

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `LLMHub Radar CI` | pull request, push to `main`, manual, reusable | release checks, type checks, migration verification, radar tests, dashboard/status-page builds |
| `LLMHub Radar Build Images` | manual only | runs CI, builds linux/amd64 images, pushes them to GHCR |
| `LLMHub Radar Deploy` | manual only | uploads deploy files, pulls the chosen image tag, backs up libSQL, runs migrations, starts web/probe services |

The image names are:

```text
ghcr.io/{owner}/llmhub-radar-dashboard:{tag}
ghcr.io/{owner}/llmhub-radar-status-page:{tag}
ghcr.io/{owner}/llmhub-radar-radar-worker:{tag}
ghcr.io/{owner}/llmhub-radar-marketplace-api:{tag}
```

Normal release order:

1. Push the release commit to GitHub.
2. Confirm `LLMHub Radar CI` is green.
3. Run `LLMHub Radar Build Images`.
4. Record the image tag from the workflow summary.
5. Run `LLMHub Radar Deploy` with that image tag and
   `restart_notifications=false`.
6. Smoke test dashboard and public pages.
7. Restart notifications only after preflight is reviewed.

Rollback is the same deploy workflow with a previous known-good image tag.

`docker-compose.radar.images.yaml` uses Docker Compose `!reset` to remove local
`build` blocks when images are supplied by GHCR. The production server must run
Docker Compose v2.24 or newer. Verify with:

```bash
docker compose version
```

Old upstream OpenStatus deploy/publish/migrate workflows are intentionally
manual-only in this fork. That prevents a push to `main` from accidentally
deploying Fly/OpenStatus services or running upstream migrations. Ordinary test
workflows may still run automatically.

## GitHub Configuration

Configure these GitHub repository secrets before the first Actions deploy:

| Name | Required | Value |
| --- | --- | --- |
| `LLMHUB_RADAR_SSH_HOST` | yes | `154.222.27.176` |
| `LLMHUB_RADAR_SSH_USER` | yes | `root` |
| `LLMHUB_RADAR_SSH_KEY` | yes | private key that can SSH to the server |
| `LLMHUB_RADAR_SSH_PORT` | no | `22` unless SSH uses a custom port |
| `LLMHUB_RADAR_GHCR_USERNAME` | if GHCR package is private | GitHub username or org user allowed to pull packages |
| `LLMHUB_RADAR_GHCR_TOKEN` | if GHCR package is private | PAT with `read:packages` |

Configure this GitHub repository variable if the server path changes:

| Name | Default |
| --- | --- |
| `LLMHUB_RADAR_DEPLOY_PATH` | `/opt/llmhub-radar` |

Use the GitHub `production` environment for the deploy workflow. Environment
review is recommended so a deploy cannot start by accident.

## Recommended Production Topology

The first production deployment should use one server with Docker Compose and
Caddy:

| Public host | Target |
| --- | --- |
| `https://llm-hub.store/` and storefront assets | versioned static storefront served by Caddy |
| `https://llm-hub.store/v1/*` | `marketplace-api` on `127.0.0.1:3010` |
| Other `https://llm-hub.store/*` routes | `status-page` on `127.0.0.1:3001` |
| `https://app.llm-hub.store` | `dashboard` on `127.0.0.1:3000` |

`llm-hub.store` is the public provider square and shareable status-page host.
`app.llm-hub.store` is the authenticated owner dashboard.

The compose file binds web and database ports to `127.0.0.1` only:

```text
127.0.0.1:3000 -> dashboard
127.0.0.1:3001 -> status-page
127.0.0.1:3010 -> marketplace-api
127.0.0.1:18080 -> libsql HTTP
127.0.0.1:15001 -> libsql replication/admin port
```

Do not expose `3000`, `3001`, `3010`, `18080`, or `15001` directly to the public
internet. Public traffic should enter through ports `80` and `443` only.

Use the example Caddy config:

```text
infra/Caddyfile.radar.example
```

DNS requirements before Caddy can issue certificates:

- `llm-hub.store A 154.222.27.176`
- `app.llm-hub.store A 154.222.27.176`
- Remove invalid or stale `AAAA` records unless IPv6 is correctly configured.

OAuth production callbacks should match the dashboard host:

```text
https://app.llm-hub.store/api/auth/callback/github
https://app.llm-hub.store/api/auth/callback/google
```

## Server Baseline

Current `llm-hub` server baseline:

| Item | Value |
| --- | --- |
| OS | Ubuntu 24.04.1 LTS |
| CPU | 8 vCPU |
| Memory | 7.8 GiB |
| Disk | 29 GiB root disk, about 26 GiB free before deployment |
| Swap | none before bootstrap |
| Docker | not installed before bootstrap |

This is enough for the MVP. Add a small swap file for build-time safety, not
because the service needs large memory at runtime:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
```

Do not allocate a large swap file on the 30G disk. `2G` is enough as a guard
for dependency installation and image builds.

Install Docker Engine from Docker's official apt repository and include the
Compose plugin:

```bash
apt update
apt install -y ca-certificates curl git ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
tee /etc/apt/sources.list.d/docker.sources >/dev/null <<'EOF'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker version
docker compose version
```

Install Caddy as the HTTPS reverse proxy:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
chmod o+r /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
systemctl enable --now caddy
```

Firewall baseline:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

Docker container logs are capped in `docker-compose.radar.yaml` with:

```text
max-size=20m
max-file=5
```

This protects the small root disk from unbounded stdout logs.

## Environment

Create the runtime env file:

```bash
cp .env.radar.example .env.radar
```

Required production values:

```text
DATABASE_URL
DATABASE_AUTH_TOKEN
AUTH_SECRET
NEXTAUTH_SECRET
NEXT_PUBLIC_DASHBOARD_URL
NEXT_PUBLIC_URL
NEXT_PUBLIC_STATUS_PAGE_URL
STATUS_PAGE_URL
CRON_SECRET
RADAR_CREDENTIAL_SECRET
RESEND_API_KEY
AUTH_GITHUB_ID
AUTH_GITHUB_SECRET
AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET
```

URL rules:

- `NEXT_PUBLIC_DASHBOARD_URL` is the public dashboard URL used by public pages.
- `NEXT_PUBLIC_URL` is the public dashboard URL.
- `NEXT_PUBLIC_STATUS_PAGE_URL` is the public status-page URL used in links and emails.
- `STATUS_PAGE_URL` is the server-side status-page URL. In Docker it should use the internal service URL, for example `http://status-page:3000`.
- `NEXT_PUBLIC_*` values are also used at Docker build time. If they are wrong
  during image build, client-side links can stay wrong until the image is rebuilt.
- `RADAR_CREDENTIAL_SECRET` must be generated once for a production database and must stay stable across deployments. Changing it makes stored provider Base URLs and API keys undecryptable.
- `RADAR_PRIORITY_POOL_SLUGS` is optional. It enables priority probe behavior
  for a comma-separated list of radar pool slugs, for example `x-llm,skyhope`.
  Keep it empty for ordinary third-party pools.

For the recommended production topology:

```text
NEXT_PUBLIC_DASHBOARD_URL=https://app.llm-hub.store
NEXT_PUBLIC_URL=https://app.llm-hub.store
AUTH_URL=https://app.llm-hub.store
NEXT_PUBLIC_STATUS_PAGE_URL=https://llm-hub.store
STATUS_PAGE_URL=http://status-page:3000
```

Optional priority probe retry:

```text
RADAR_PRIORITY_POOL_SLUGS=x-llm
RADAR_PRIORITY_PROBE_RETRIES=1
RADAR_PRIORITY_PROBE_RETRY_BACKOFF_MS=1500
```

Priority retry is intentionally narrow: it only retries transient probe failures
such as timeout, network error, and upstream 5xx server error. It does not retry
auth errors, missing models, quota errors, rate limits, or bad responses.
The retry worker records only the final probe result, and the final latency
includes the earlier failed attempt plus backoff time. P95/P50 statistics keep
their normal calculation.

Generate the production credential secret once:

```bash
openssl rand -base64 48
```

Store it in `.env.radar` or a secret manager. Do not commit it to Git, do not regenerate it during CI/CD, and migrate it together with the database backup when moving servers.

Generate the other runtime secrets separately:

```bash
openssl rand -base64 48 # AUTH_SECRET
openssl rand -base64 48 # NEXTAUTH_SECRET
openssl rand -base64 48 # CRON_SECRET
```

## Deployment Order

Before applying database migrations to production, confirm the migration
verification has passed in `LLMHub Radar CI`:

```text
LLMHub Radar CI -> Verify migrations
```

This script creates temporary libSQL databases and verifies both paths:

- empty database migration from `0000` to latest
- existing database migration from `0080` to latest with seeded OpenStatus and
  Radar rows

It specifically checks that `0081_page_subscriber_locale.sql` and
`0082_radar_page_component_binding.sql` preserve existing OpenStatus page,
subscriber, and component data while backfilling Radar page-component bindings.

Build images with the manual `LLMHub Radar Build Images` workflow. The workflow
runs CI first, then publishes these images to GHCR:

```text
llmhub-radar-dashboard:{tag}
llmhub-radar-status-page:{tag}
llmhub-radar-radar-worker:{tag}
llmhub-radar-marketplace-api:{tag}
```

Deploy with the manual `LLMHub Radar Deploy` workflow using the same image tag.
Keep `restart_notifications=false` for normal releases. The deploy script:

- validates the compose config before changing services
- logs in to GHCR if package pull credentials are configured
- pulls the selected dashboard/status-page/worker images
- backs up the `llmhub-radar-libsql-data` and `llmhub-radar-media-data` volumes
- starts libSQL
- runs `db-migrate` as a one-shot container
- starts `dashboard`, `status-page`, and `radar-probe-worker`
- starts Marketplace PostgreSQL, runs Marketplace migrations, and starts the
  Marketplace API and maintenance loop
- installs the static storefront under a versioned release directory
- validates and reloads Caddy only after local services are healthy
- restores the previous storefront symlink and Caddy config if public smoke
  tests fail
- smoke-tests local services, public Marketplace APIs, and the storefront
- leaves `radar-notification-worker` untouched by default

The server-side deployment script can be run manually for emergency rollback or
debugging after the workflow has uploaded deployment files:

```bash
cd /opt/llmhub-radar
LLMHUB_RADAR_IMAGE_OWNER=<github-owner-lowercase> \
LLMHUB_RADAR_IMAGE_TAG=<image-tag> \
bash scripts/deploy-llmhub-radar.sh
```

Local server builds are fallback only. Use them when GitHub Actions or GHCR is
unavailable, not for normal production release:

```bash
docker compose -f docker-compose.radar.yaml up -d --build \
  libsql db-migrate dashboard status-page radar-probe-worker
```

Before enabling subscriber notifications, run preflight and review the output.
The deploy workflow does this only when `restart_notifications=true`:

```bash
docker compose --env-file .env.radar --env-file .env.images -f docker-compose.radar.yaml -f docker-compose.radar.images.yaml run --rm \
  radar-probe-worker bun src/scripts/radar-notification-preflight.ts
```

The notification worker is behind the `notifications` profile on purpose. A
normal redeploy should not start it unless the operator explicitly enables that
profile.

## First Server Deployment Runbook

Use this exact order for the first deployment to `llm-hub`:

1. Point DNS to the server and remove stale IPv6 records.
2. Bootstrap the server: swap, Docker, Caddy, firewall.
3. Create `/opt/llmhub-radar/.env.radar` from `.env.radar.example`.
4. Confirm Caddy is installed and the current production config is valid. The
   deploy script installs the candidate config only after Marketplace API is
   healthy, then verifies `/v1/models`, the storefront, and status-page fallback
   routing.
5. Configure GitHub Actions secrets and variables.
6. Commit and push local code changes to GitHub.
7. Confirm `LLMHub Radar CI` is green.
8. Run `LLMHub Radar Build Images` and record the image tag.
9. Run `LLMHub Radar Deploy` with `restart_notifications=false`.
10. Smoke test dashboard login and public status pages.
11. Run notification preflight.
12. Start `radar-notification-worker` only after preflight looks correct.
13. Create the first database backup.

The deploy workflow uploads `docker-compose.radar.yaml`,
`docker-compose.radar.images.yaml`, `.env.radar.example`,
`apps/storefront`, `infra/Caddyfile.radar.example`, and
`scripts/deploy-llmhub-radar.sh` to `/opt/llmhub-radar`. Before extraction it
backs up the previous Compose files, image metadata, deploy script, Caddy config,
and storefront target. The server does not need a full Git checkout for normal
deploys, but `.env.radar` must already exist in that directory.

The first release that introduces Marketplace cannot roll back through an older
image tag because that tag has no Marketplace API image. Restore the release
backup recorded in `/opt/llmhub-radar/.previous-release-backup`, restore its
Caddy config, and recreate the previous three application services. Keep the
Marketplace PostgreSQL volume unless its data is known to be corrupt. After the
first successful Marketplace release, normal tag-based rollback is available
again.

The deploy script writes `.env.images` with the current image registry, owner,
and tag. It contains no runtime secrets. Use it for manual inspection, restart,
rollback, or notification commands after the first Actions deploy.

Manual inspection commands after deploy:

```bash
cd /opt/llmhub-radar
docker compose --env-file .env.radar --env-file .env.images -f docker-compose.radar.yaml -f docker-compose.radar.images.yaml ps
docker compose --env-file .env.radar --env-file .env.images -f docker-compose.radar.yaml -f docker-compose.radar.images.yaml logs --tail=200 dashboard
docker compose --env-file .env.radar --env-file .env.images -f docker-compose.radar.yaml -f docker-compose.radar.images.yaml logs --tail=200 status-page
docker compose --env-file .env.radar --env-file .env.images -f docker-compose.radar.yaml -f docker-compose.radar.images.yaml logs --tail=200 radar-probe-worker
docker compose --env-file .env.radar --env-file .env.images -f docker-compose.radar.yaml -f docker-compose.radar.images.yaml logs --tail=200 marketplace-api marketplace-maintenance
```

Notification worker:

```bash
docker compose --env-file .env.radar --env-file .env.images -f docker-compose.radar.yaml -f docker-compose.radar.images.yaml run --rm \
  radar-probe-worker bun src/scripts/radar-notification-preflight.ts
docker compose --env-file .env.radar --env-file .env.images -f docker-compose.radar.yaml -f docker-compose.radar.images.yaml --profile notifications up -d --no-build \
  radar-notification-worker
docker compose --env-file .env.radar --env-file .env.images -f docker-compose.radar.yaml -f docker-compose.radar.images.yaml logs --tail=200 radar-notification-worker
```

Redeploy later without notifications:

1. Confirm CI is green.
2. Run `LLMHub Radar Build Images`.
3. Run `LLMHub Radar Deploy` with the new image tag and
   `restart_notifications=false`.

Then run notification preflight and restart notification worker explicitly if
the release changed notification behavior.

## Backup

The production account database, uploaded claim evidence, and Marketplace
database live in `llmhub-radar-libsql-data`, `llmhub-radar-media-data`, and
`llmhub-radar-marketplace-postgres-data`. Treat their backups as one release
set. Marketplace PostgreSQL uses a logical `pg_dump`; do not copy its live
volume files.

Manual backup:

```bash
mkdir -p /opt/backups/llmhub-radar
docker run --rm \
  -v llmhub-radar-libsql-data:/data:ro \
  -v /opt/backups/llmhub-radar:/backup \
  ubuntu:24.04 \
  tar czf /backup/libsql-$(date +%F-%H%M%S).tar.gz -C /data .
docker run --rm \
  -v llmhub-radar-media-data:/data:ro \
  -v /opt/backups/llmhub-radar:/backup \
  ubuntu:24.04 \
  tar czf /backup/media-$(date +%F-%H%M%S).tar.gz -C /data .
docker exec llmhub-radar-marketplace-postgres sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip -c > /opt/backups/llmhub-radar/marketplace-postgres-$(date +%F-%H%M%S).sql.gz
ls -lh /opt/backups/llmhub-radar
```

Keep at least the latest 7 daily backups on the server. For production, copy
backups off-server as soon as the first real users exist.

## Notification Safety

`radar:cron` only runs probes and writes probe status. It does not dispatch email or webhook notifications.

`radar:notifications` only dispatches events that are both recent and created
after the notification worker process started:

```text
RADAR_NOTIFICATION_MAX_EVENT_AGE_MS=900000
```

The default age window is 15 minutes. The worker also records its own
`replayGuardStartedAt` timestamp on startup and ignores pending or retryable
failed rows created before that timestamp. This is a code-level replay guard:
restarting or redeploying the notification worker must not send historical
backlog by default.

Startup and completion logs include:

- `replayGuardStartedAt`
- `dispatchCutoff`
- `ignoredOlderThanCutoff`

If a deployment was paused for a long time, old pending rows remain ignored by
the worker and should be reviewed manually.

Preflight output includes:

- pending notification count
- retryable failed notification count
- oldest/newest pending event time
- fresh dispatchable count
- stale dispatchable count

If `staleDispatchable > 0`, do not widen `RADAR_NOTIFICATION_MAX_EVENT_AGE_MS` in production just to clear the backlog. Review or mark those events skipped with an explicit admin action.

## Public Status Levels

The public provider page should expose three business-facing states:

| Public status | Rule |
| --- | --- |
| healthy | all active API keys are usable enough for normal traffic |
| degraded | at least one active API key is degraded, slow, misconfigured, or unavailable, but not all active keys are down |
| outage | all active API keys are unavailable or blocked by configuration errors |

Internal target states may remain more detailed:

```text
unknown, operational, degraded, down, paused, configuration_error
```

Mapping:

- `operational` contributes to healthy.
- `degraded` contributes to degraded.
- `down` and `configuration_error` contribute to outage only when all active targets are affected; otherwise degraded.
- `unknown` and `paused` are internal states and should not become a fourth public health level.

The UI may still have an `info` visual variant for maintenance/unknown. Radar should not expose it as a normal provider health state unless a maintenance feature is explicitly added.

## HTTP Cron Fallback

Dashboard also exposes separate cron endpoints:

```text
GET/POST /api/cron/radar/run
GET/POST /api/cron/radar/notifications
```

Both require:

```text
Authorization: Bearer $CRON_SECRET
```

Production must set `CRON_SECRET`. HTTP cron is a fallback for hosted schedulers; the preferred Docker line uses worker containers.

## Release Checklist

Use the detailed release checklist before the first production deployment and
before any later release that changes probes, subscribers, migrations, auth, or
public status pages:

```text
docs/LLMHUB_RADAR_RELEASE_CHECKLIST.md
```
