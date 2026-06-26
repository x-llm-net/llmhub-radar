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
.env.radar.example
apps/radar-worker/Dockerfile
```

The worker image runs the dashboard script entrypoints directly with Bun:

```bash
pnpm radar:cron
pnpm radar:notifications
pnpm radar:notifications:preflight
```

The Next.js standalone dashboard/status-page images are kept for web traffic only.

## Recommended Production Topology

The first production deployment should use one server with Docker Compose and
Caddy:

| Public host | Target |
| --- | --- |
| `https://llm-hub.store` | `status-page` on `127.0.0.1:3001` |
| `https://app.llm-hub.store` | `dashboard` on `127.0.0.1:3000` |

`llm-hub.store` is the public provider square and shareable status-page host.
`app.llm-hub.store` is the authenticated owner dashboard.

The compose file binds web and database ports to `127.0.0.1` only:

```text
127.0.0.1:3000 -> dashboard
127.0.0.1:3001 -> status-page
127.0.0.1:18080 -> libsql HTTP
127.0.0.1:15001 -> libsql replication/admin port
```

Do not expose `3000`, `3001`, `18080`, or `15001` directly to the public
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

- `NEXT_PUBLIC_URL` is the public dashboard URL.
- `NEXT_PUBLIC_STATUS_PAGE_URL` is the public status-page URL used in links and emails.
- `STATUS_PAGE_URL` is the server-side status-page URL. In Docker it should use the internal service URL, for example `http://status-page:3000`.
- `RADAR_CREDENTIAL_SECRET` must be generated once for a production database and must stay stable across deployments. Changing it makes stored provider Base URLs and API keys undecryptable.

For the recommended production topology:

```text
NEXT_PUBLIC_URL=https://app.llm-hub.store
AUTH_URL=https://app.llm-hub.store
NEXT_PUBLIC_STATUS_PAGE_URL=https://llm-hub.store
STATUS_PAGE_URL=http://status-page:3000
```

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

Before applying database migrations to production, run the local migration
verification script:

```bash
pnpm --filter @openstatus/db verify:radar-migrations
```

This script creates temporary libSQL databases and verifies both paths:

- empty database migration from `0000` to latest
- existing database migration from `0080` to latest with seeded OpenStatus and
  Radar rows

It specifically checks that `0081_page_subscriber_locale.sql` and
`0082_radar_page_component_binding.sql` preserve existing OpenStatus page,
subscriber, and component data while backfilling Radar page-component bindings.

Build and start the non-notification stack first:

```bash
docker compose -f docker-compose.radar.yaml up -d --build \
  libsql db-migrate dashboard status-page radar-probe-worker
```

Then verify:

```bash
docker compose -f docker-compose.radar.yaml logs -f radar-probe-worker
docker compose -f docker-compose.radar.yaml ps
```

Before enabling subscriber notifications, run the preflight command:

```bash
docker compose -f docker-compose.radar.yaml run --rm \
  radar-probe-worker bun src/scripts/radar-notification-preflight.ts
```

Only start the notification worker after reviewing the output:

```bash
docker compose -f docker-compose.radar.yaml --profile notifications up -d \
  radar-notification-worker
```

The notification worker is behind the `notifications` profile on purpose. A normal redeploy should not start it unless the operator explicitly enables that profile.

## First Server Deployment Runbook

Use this exact order for the first deployment to `llm-hub`:

1. Point DNS to the server and remove stale IPv6 records.
2. Bootstrap the server: swap, Docker, Caddy, firewall.
3. Commit and push local code changes to GitHub.
4. Clone or pull the repository on the server under `/opt/llmhub-radar`.
5. Create `/opt/llmhub-radar/.env.radar` from `.env.radar.example`.
6. Copy `infra/Caddyfile.radar.example` to `/etc/caddy/Caddyfile` and reload
   Caddy.
7. Run local release checks before touching production data.
8. Start the non-notification stack.
9. Smoke test dashboard login and public status pages.
10. Run notification preflight.
11. Start `radar-notification-worker` only after preflight looks correct.
12. Create the first database backup.

Server commands after the repo is present:

```bash
cd /opt/llmhub-radar
docker compose -f docker-compose.radar.yaml up -d --build \
  libsql db-migrate dashboard status-page radar-probe-worker
docker compose -f docker-compose.radar.yaml ps
docker compose -f docker-compose.radar.yaml logs --tail=200 dashboard
docker compose -f docker-compose.radar.yaml logs --tail=200 status-page
docker compose -f docker-compose.radar.yaml logs --tail=200 radar-probe-worker
```

Notification worker:

```bash
docker compose -f docker-compose.radar.yaml run --rm \
  radar-probe-worker bun src/scripts/radar-notification-preflight.ts
docker compose -f docker-compose.radar.yaml --profile notifications up -d \
  radar-notification-worker
docker compose -f docker-compose.radar.yaml logs --tail=200 radar-notification-worker
```

Redeploy later without notifications:

```bash
cd /opt/llmhub-radar
git pull --ff-only
docker compose -f docker-compose.radar.yaml up -d --build \
  libsql db-migrate dashboard status-page radar-probe-worker
docker compose -f docker-compose.radar.yaml ps
```

Then run notification preflight and restart notification worker explicitly if
the release changed notification behavior.

## Backup

The production database lives in the Docker volume
`llmhub-radar-libsql-data`. Back up the volume before every production deploy
that changes migrations or persistence code.

Manual backup:

```bash
mkdir -p /opt/backups/llmhub-radar
docker run --rm \
  -v llmhub-radar-libsql-data:/data:ro \
  -v /opt/backups/llmhub-radar:/backup \
  ubuntu:24.04 \
  tar czf /backup/libsql-$(date +%F-%H%M%S).tar.gz -C /data .
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
