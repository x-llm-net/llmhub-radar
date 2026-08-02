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
- [ ] Marketplace packages type checks and tests pass:
  `pnpm --filter @llmhub/marketplace-db typecheck && pnpm --filter @llmhub/marketplace-api typecheck`
- [ ] Radar service tests pass where relevant:
  `pnpm --filter @openstatus/services test src/radar`
- [ ] Changed files pass formatter and lint:
  `pnpm exec oxfmt --check <files>`
  `pnpm exec oxlint <files>`

## 2. Database And Migrations

- [ ] Production database backup exists before deployment.
- [ ] Marketplace PostgreSQL backup exists before deployment, except on its
  first creation.
- [ ] Marketplace migration `0011_spooky_black_bird.sql` is confirmed to add
  only billing authorization objects after `0010_route_binding_map.sql`.
- [ ] Migration `0012_chilly_black_tarantula.sql` adds only the nullable
  settlement payload used for automatic capture retry.
- [ ] Migration verification passes locally:
  `pnpm --filter @openstatus/db verify:radar-migrations`
- [ ] Empty database path is verified.
- [ ] Existing database path from pre-Radar OpenStatus tables is verified.
- [ ] Migrations `0081_page_subscriber_locale.sql` and
  `0082_radar_page_component_binding.sql` preserve existing status pages,
  subscribers, and page components.
- [ ] Migration `0092_dapper_freak.sql` adds nullable
  `radar_pool.deleted_at` without changing existing provider rows.
- [ ] No migration requires regenerating `RADAR_CREDENTIAL_SECRET`.

## 3. Environment

- [ ] `.env.radar` is created from `.env.radar.example`.
- [ ] `.env.radar` and `.env.local` are ignored by Git and are not committed.
- [ ] `DATABASE_URL` and `DATABASE_AUTH_TOKEN` point to the intended database.
- [ ] `AUTH_SECRET` and `NEXTAUTH_SECRET` are set and stable.
- [ ] `NEXT_PUBLIC_DASHBOARD_URL` points to the dashboard public URL:
  `https://app.llm-hub.store`.
- [ ] `NEXT_PUBLIC_URL` points to the dashboard public URL:
  `https://app.llm-hub.store`.
- [ ] `AUTH_URL` points to the dashboard public URL:
  `https://app.llm-hub.store`.
- [ ] `NEXT_PUBLIC_STATUS_PAGE_URL` points to the public status-page URL:
  `https://llm-hub.store`.
- [ ] `STATUS_PAGE_URL` points to the internal status-page service URL in
  Docker, for example `http://status-page:3000`.
- [ ] Marketplace PostgreSQL credentials, public source URL, sync interval, and
  cleanup interval are configured.
- [ ] `LLMHUB_ROUTER_FAKE=false` in production.
- [ ] `LLMHUB_RELAY_SYNC_URL`, `LLMHUB_RELAY_SYNC_TOKEN`,
  `LLMHUB_RELAY_REQUEST_URL`, and `LLMHUB_RELAY_REQUEST_TOKEN` are non-empty
  and match the deployed New API internal endpoints.
- [ ] Docker build args for `dashboard` and `status-page` use the same
  production public URLs, not localhost placeholders.
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
- [ ] Root filesystem has at least 8 GiB free before pulling release images.
- [ ] Caddy is installed and serving
  `infra/Caddyfile.radar.example` routes.
- [ ] `https://llm-hub.store/v1/models` reaches Marketplace API and a normal
  public status-page route still reaches `status-page`.
- [ ] Firewall allows only SSH, HTTP, and HTTPS by default:
  `ufw status`.
- [ ] `docker-compose.radar.yaml` binds internal ports to `127.0.0.1`, not
  public interfaces.
- [ ] Container logs have rotation limits configured.
- [ ] `/opt/llmhub-radar/.env.radar` exists on the server.
- [ ] Docker Compose is v2.24 or newer so `docker-compose.radar.images.yaml`
  can use `!reset`.

## 5. GitHub Actions Deployment

- [ ] GitHub repository secrets are configured:
  `LLMHUB_RADAR_SSH_HOST`, `LLMHUB_RADAR_SSH_USER`,
  `LLMHUB_RADAR_SSH_KEY`, and optional `LLMHUB_RADAR_SSH_PORT`.
- [ ] If GHCR packages are private, `LLMHUB_RADAR_GHCR_USERNAME` and
  `LLMHUB_RADAR_GHCR_TOKEN` are configured. The token has `read:packages`.
- [ ] GitHub repository variable `LLMHUB_RADAR_DEPLOY_PATH` is set if the
  server path is not `/opt/llmhub-radar`.
- [ ] The `production` environment exists in GitHub and requires manual review
  if deploy approval is desired.
- [ ] `LLMHub Radar CI` is green for the release commit.
- [ ] `LLMHub Radar Build Images` has completed successfully.
- [ ] The produced image tag is recorded from the workflow summary.
- [ ] `LLMHub Radar Deploy` is run with the recorded image tag.
- [ ] Normal deploy uses `restart_notifications=false`.
- [ ] The deploy workflow summary shows the expected image tag.
- [ ] The deploy workflow completed smoke tests for dashboard, status-page,
  Marketplace health, public `/v1/models`, `/v1/homepage`, and the static
  storefront.

## 6. Runtime Verification

- [ ] `.env.images` exists on the server after deploy and contains only image
  registry, owner, and tag values.
- [ ] `docker compose --env-file .env.radar --env-file .env.images -f docker-compose.radar.yaml -f docker-compose.radar.images.yaml ps`
  shows healthy/running `dashboard`, `status-page`, `libsql`,
  `marketplace-postgres`, `marketplace-api`, `marketplace-maintenance`, and
  `radar-probe-worker`, `marketplace-probe-worker`,
  `marketplace-catalog-refresh-worker`, and `marketplace-relay-config-sync`.
- [ ] `db-migrate` exits successfully.
- [ ] `marketplace-migrate` exits successfully without seeding a built-in
  model catalog.
- [ ] `marketplace-maintenance` logs show a successful legacy sync and cleanup.
- [ ] Relay config sync creates an active New API binding and repeated sync is
  idempotent.
- [ ] New API sync/request health endpoints accept their own token and reject
  missing or mismatched credentials.
- [ ] One non-streaming LLMHub request succeeds through the bound channel;
  `hub_billing_authorizations.status` is `captured`, usage is persisted, and
  the ledger balance decreases by the actual charge rather than the reserve.
- [ ] A failed request releases its billing authorization; an expired reserve
  is released by `marketplace-maintenance`.
- [ ] A staged settlement left in `reserved` is captured by
  `marketplace-maintenance` and is not refunded as an ordinary expiry.
- [ ] `/opt/llmhub-radar/storefront/current` points to the deployed image tag.
- [ ] `radar-probe-worker` logs show regular ticks and no credential decrypt
  failures.
- [ ] `radar-notification-worker` is not started by default.

## 7. Notification Safety

- [ ] Run notification preflight before enabling notifications:
  `docker compose --env-file .env.radar --env-file .env.images -f docker-compose.radar.yaml -f docker-compose.radar.images.yaml run --rm radar-probe-worker bun src/scripts/radar-notification-preflight.ts`
- [ ] `pending`, `retryable failed`, `fresh dispatchable`, and
  `stale dispatchable` counts are reviewed.
- [ ] If stale dispatchable events exist, they are reviewed manually instead of
  widening `RADAR_NOTIFICATION_MAX_EVENT_AGE_MS`.
- [ ] Notification worker startup logs include `replayGuardStartedAt`,
  `dispatchCutoff`, and `ignoredOlderThanCutoff`.
- [ ] Start notification worker only after preflight is understood:
  `docker compose --env-file .env.radar --env-file .env.images -f docker-compose.radar.yaml -f docker-compose.radar.images.yaml --profile notifications up -d --no-build radar-notification-worker`
- [ ] Email and webhook notifications are verified with a test subscriber.

## 8. Product Smoke Test

- [ ] Sign in with email magic link.
- [ ] Sign in with GitHub OAuth.
- [ ] Sign in with Google OAuth.
- [ ] Create one service provider status page.
- [ ] Add one API key.
- [ ] Model discovery populates models after Base URL and API key are entered.
- [ ] Select one probe model for the API key.
- [ ] Save API key and confirm one probe run is scheduled automatically.
- [ ] Public page opens with the configured slug.
- [ ] Public page shows `近 7 天稳定性概览` / `7-day stability overview`
  with 3-hour buckets.
- [ ] Public page shows `API 密钥详情` / `API key details`.
- [ ] API key card shows status, model family, probe model, 7-day
  availability, P50 first token, P95 first token, recent runs, model catalog,
  interval, and last check.
- [ ] 7-day stability bucket tooltip opens on hover and does not show misleading
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

## 9. Public Page Review

- [ ] Header logo and navigation link to the correct public paths.
- [ ] `https://llm-hub.store/` contains the `LLMHub Marketplace` deployment
  marker and loads real `/v1/homepage` data rather than a mock fixture.
- [ ] `状态` / `Status` tab opens the status page.
- [ ] `事件公告` / `Events` tab opens the events page.
- [ ] Footer brand links to `https://llm-hub.store`.
- [ ] No visible `openstatus.dev` branding remains on Radar public pages.
- [ ] Judgment criteria are shown at the bottom and do not interrupt the main
  reading flow.
- [ ] 7-day empty/no-data buckets render gray and do not reduce calculated
  availability for windows with data.
- [ ] Service-specific iframe embed page exists under `/radar/{slug}/embed`,
  generates the current provider iframe, and does not mix platform API docs into
  the provider page.
- [ ] Public developer API docs exist under `/developers/api`.
- [ ] `POST /api/radar/providers/query` returns only public-pool providers,
  sends `Cache-Control: public, max-age=600`, supports ETag/304, and enforces
  the slug limit.
- [ ] Overall public state uses only healthy, degraded, and outage semantics.
- [ ] Unknown/paused/configuration details are not exposed as a fourth public
  provider health level.

## 10. Backup And Recovery

- [ ] Database Docker volume `llmhub-radar-libsql-data` has a fresh backup.
- [ ] Media Docker volume `llmhub-radar-media-data` has a fresh backup.
- [ ] Marketplace PostgreSQL has a fresh compressed SQL backup.
- [ ] Matching database and media backup files are listed under
  `/opt/backups/llmhub-radar`.
- [ ] Restore path is understood before the first real production migration.
- [ ] At least the latest 7 daily backups are retained.
- [ ] Once real users exist, backups are copied off-server.

## 11. Post-Release Watch

- [ ] Watch dashboard logs for auth callback errors.
- [ ] Watch status-page logs for 404/500 on public slugs.
- [ ] Watch probe worker logs for upstream failures and cost spikes.
- [ ] Watch notification worker logs for duplicate sends.
- [ ] Verify one real public provider page from a clean browser session.
- [ ] Verify one email and one webhook subscription from a clean browser
  session.
- [ ] Record any release issue in the project docs before the next deploy.
