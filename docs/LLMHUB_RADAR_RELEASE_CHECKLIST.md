# LLMHub Radar Release Checklist

Use this checklist before the first production release and before any later
release that changes probes, subscribers, migrations, auth, or public status
pages.

## 1. Code Readiness

- [ ] `git status` reviewed. Unrelated local changes are understood.
- [ ] Status page type check passes:
  `pnpm --filter @openstatus/status-page tsc --pretty false`
- [ ] Dashboard type check passes:
  `pnpm --filter @openstatus/dashboard tsc --pretty false`
- [ ] Radar service tests pass where relevant:
  `pnpm --filter @openstatus/services test src/radar`
- [ ] Changed files pass formatter and lint:
  `pnpm exec oxfmt --check <files>`
  `pnpm exec oxlint <files>`

## 2. Database And Migrations

- [ ] Production database backup exists before deployment.
- [ ] Migration verification passes locally:
  `pnpm --filter @openstatus/db verify:radar-migrations`
- [ ] Empty database path is verified.
- [ ] Existing database path from pre-Radar OpenStatus tables is verified.
- [ ] Migrations `0081_page_subscriber_locale.sql` and
  `0082_radar_page_component_binding.sql` preserve existing status pages,
  subscribers, and page components.
- [ ] No migration requires regenerating `RADAR_CREDENTIAL_SECRET`.

## 3. Environment

- [ ] `.env.radar` is created from `.env.radar.example`.
- [ ] `.env.radar` and `.env.local` are ignored by Git and are not committed.
- [ ] `DATABASE_URL` and `DATABASE_AUTH_TOKEN` point to the intended database.
- [ ] `AUTH_SECRET` and `NEXTAUTH_SECRET` are set and stable.
- [ ] `NEXT_PUBLIC_URL` points to the dashboard public URL:
  `https://app.llm-hub.store`.
- [ ] `AUTH_URL` points to the dashboard public URL:
  `https://app.llm-hub.store`.
- [ ] `NEXT_PUBLIC_STATUS_PAGE_URL` points to the public status-page URL:
  `https://llm-hub.store`.
- [ ] `STATUS_PAGE_URL` points to the internal status-page service URL in
  Docker, for example `http://status-page:3000`.
- [ ] `CRON_SECRET` is set to a random production value.
- [ ] `RADAR_CREDENTIAL_SECRET` is generated once, stored securely, and will
  not be regenerated during redeploys.
- [ ] `RESEND_API_KEY` and `RESEND_FROM` are configured.
- [ ] GitHub OAuth callback URL matches production dashboard URL.
- [ ] Google OAuth callback URL matches production dashboard URL.

## 4. Server Bootstrap

- [ ] DNS `A` record for `llm-hub.store` points to `154.222.27.176`.
- [ ] DNS `A` record for `app.llm-hub.store` points to `154.222.27.176`.
- [ ] Stale or invalid `AAAA` records are removed unless IPv6 is configured.
- [ ] `2G` swap file exists and is active:
  `swapon --show`.
- [ ] Docker Engine and Docker Compose plugin are installed:
  `docker version` and `docker compose version`.
- [ ] Caddy is installed and serving
  `infra/Caddyfile.radar.example` routes.
- [ ] Firewall allows only SSH, HTTP, and HTTPS by default:
  `ufw status`.
- [ ] `docker-compose.radar.yaml` binds internal ports to `127.0.0.1`, not
  public interfaces.
- [ ] Container logs have rotation limits configured.

## 5. Docker Deployment

- [ ] Build/start the non-notification stack first:
  `docker compose -f docker-compose.radar.yaml up -d --build libsql db-migrate dashboard status-page radar-probe-worker`
- [ ] `docker compose -f docker-compose.radar.yaml ps` shows healthy/running
  `dashboard`, `status-page`, `libsql`, and `radar-probe-worker`.
- [ ] `db-migrate` exits successfully.
- [ ] `radar-probe-worker` logs show regular ticks and no credential decrypt
  failures.
- [ ] `radar-notification-worker` is not started by default.

## 6. Notification Safety

- [ ] Run notification preflight before enabling notifications:
  `docker compose -f docker-compose.radar.yaml run --rm radar-probe-worker bun src/scripts/radar-notification-preflight.ts`
- [ ] `pending`, `retryable failed`, `fresh dispatchable`, and
  `stale dispatchable` counts are reviewed.
- [ ] If stale dispatchable events exist, they are reviewed manually instead of
  widening `RADAR_NOTIFICATION_MAX_EVENT_AGE_MS`.
- [ ] Notification worker startup logs include `replayGuardStartedAt`,
  `dispatchCutoff`, and `ignoredOlderThanCutoff`.
- [ ] Start notification worker only after preflight is understood:
  `docker compose -f docker-compose.radar.yaml --profile notifications up -d radar-notification-worker`
- [ ] Email and webhook notifications are verified with a test subscriber.

## 7. Product Smoke Test

- [ ] Sign in with email magic link.
- [ ] Sign in with GitHub OAuth.
- [ ] Sign in with Google OAuth.
- [ ] Create one service provider status page.
- [ ] Add one API key.
- [ ] Model discovery populates models after Base URL and API key are entered.
- [ ] Select one probe model for the API key.
- [ ] Save API key and confirm one probe run is scheduled automatically.
- [ ] Public page opens with the configured slug.
- [ ] Public page shows `45 天稳定性概览` / `45-day stability overview`.
- [ ] Public page shows `API 密钥详情` / `API key details`.
- [ ] API key card shows status, model family, probe model, 7-day
  availability, P50 first token, P95 first token, recent runs, model catalog,
  interval, and last check.
- [ ] 45-day component bar tooltip opens on hover and does not show misleading
  pin/unpin instructions.
- [ ] Subscribe modal shows email, webhook, RSS, and JSON only.
- [ ] Radar-specific subscription copy says API key, not component.
- [ ] Subscribe all API keys by email.
- [ ] Subscribe selected API keys by email.
- [ ] Subscribe all API keys by webhook.
- [ ] Subscribe selected API keys by webhook.
- [ ] Email confirmation link works.
- [ ] Webhook verification request works.
- [ ] Create a service event announcement.
- [ ] Create a planned maintenance announcement.
- [ ] Confirm announcements appear on `/events`.
- [ ] Confirm event detail pages open from `/events`.
- [ ] Confirm notification sending is opt-in when creating announcements.

## 8. Public Page Review

- [ ] Header logo and navigation link to the correct public paths.
- [ ] `状态` / `Status` tab opens the status page.
- [ ] `事件公告` / `Events` tab opens the events page.
- [ ] Footer brand links to `https://llm-hub.store`.
- [ ] No visible `openstatus.dev` branding remains on Radar public pages.
- [ ] Judgment criteria are shown at the bottom and do not interrupt the main
  reading flow.
- [ ] 45-day empty/no-data days render gray and do not reduce calculated
  availability for days with data.
- [ ] Overall public state uses only healthy, degraded, and outage semantics.
- [ ] Unknown/paused/configuration details are not exposed as a fourth public
  provider health level.

## 9. Backup And Recovery

- [ ] Database Docker volume `llmhub-radar-libsql-data` has a fresh backup.
- [ ] Backup file is listed under `/opt/backups/llmhub-radar`.
- [ ] Restore path is understood before the first real production migration.
- [ ] At least the latest 7 daily backups are retained.
- [ ] Once real users exist, backups are copied off-server.

## 10. Post-Release Watch

- [ ] Watch dashboard logs for auth callback errors.
- [ ] Watch status-page logs for 404/500 on public slugs.
- [ ] Watch probe worker logs for upstream failures and cost spikes.
- [ ] Watch notification worker logs for duplicate sends.
- [ ] Verify one real public provider page from a clean browser session.
- [ ] Verify one email and one webhook subscription from a clean browser
  session.
- [ ] Record any release issue in the project docs before the next deploy.
