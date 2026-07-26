# LLMHub Radar Local Development

Use this flow for day-to-day UI and product iteration. Docker remains the deployment verification path, not the default loop for small edits.

## Services

Local development runs:

| Service | Runtime | URL |
| --- | --- | --- |
| dashboard | local `next dev` | `http://localhost:3000` |
| status-page | local `next dev` | `http://127.0.0.1:3001` |
| marketplace-api | local `tsx watch` | `http://127.0.0.1:3010` |
| libsql | Docker | `http://localhost:18080` |
| marketplace-postgres | Docker | `127.0.0.1:55432` |
| radar-probe-worker | Docker | no public port |

The local web apps read `.env.radar`, then override Docker-only values:

- `DATABASE_URL=http://localhost:18080`
- `NEXT_PUBLIC_DASHBOARD_URL=http://localhost:3000`
- `NEXT_PUBLIC_URL=http://localhost:3000`
- `NEXT_PUBLIC_STATUS_PAGE_URL=http://127.0.0.1:3001`
- `STATUS_PAGE_URL=http://127.0.0.1:3001`
- `NEXT_PUBLIC_MARKETPLACE_API_URL=http://127.0.0.1:3010`

Do not print `.env.radar` during normal debugging. Check whether a variable exists instead of echoing secret values.

## Single Database Rule

`http://localhost:18080` is the only active local Radar database. The local
web apps and Docker workers must always use it together.

- Set `RADAR_DEV_DATABASE_URL=http://localhost:18080` in `.env.radar`.
- Do not point app-level `.env.local` files at a legacy `file:` database.
- Do not restore an archived `openstatus-dev.db` into the active path. Migrate
  required records into libsql first, then keep the old file as a read-only
  backup.

## Start

Prepare the shared infrastructure and free web ports:

```bash
pnpm dev:radar:prepare
```

Start both web apps and the Marketplace API with hot reload:

```bash
pnpm dev:radar
```

Open:

- Dashboard: `http://localhost:3000/radar`
- Data and rankings: `http://localhost:3000/rankings`
- Public status page: `http://127.0.0.1:3001/skyhope/zh`

## When To Use Docker Builds

Use Docker for deployment simulation or release checks:

```bash
docker compose -f docker-compose.radar.yaml build dashboard status-page
docker compose -f docker-compose.radar.yaml up -d --no-deps dashboard status-page
```

To verify the production Marketplace container separately:

```bash
docker compose --env-file .env.radar -f docker-compose.radar.yaml build marketplace-api
docker compose --env-file .env.radar -f docker-compose.radar.yaml up -d marketplace-postgres
docker compose --env-file .env.radar -f docker-compose.radar.yaml run --rm marketplace-migrate
docker compose --env-file .env.radar -f docker-compose.radar.yaml up -d marketplace-api marketplace-maintenance
curl -fsS http://127.0.0.1:3010/health
```

Do not use Docker rebuilds for routine CSS, copy, component, or page layout changes.

## Troubleshooting

If ports are already occupied by Docker web containers:

```bash
pnpm dev:radar:stop-web
```

If dashboard shows data from the wrong workspace, log out and sign in with the account that owns the provider page, or clear the `workspace-slug` cookie.

If the probe worker should not run during UI-only work:

```bash
docker compose -f docker-compose.radar.yaml stop radar-probe-worker
```
