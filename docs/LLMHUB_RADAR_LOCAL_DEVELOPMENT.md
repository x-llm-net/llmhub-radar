# LLMHub Radar Local Development

Use this flow for day-to-day UI and product iteration. Docker remains the deployment verification path, not the default loop for small edits.

## Services

Local development runs:

| Service | Runtime | URL |
| --- | --- | --- |
| dashboard | local `next dev` | `http://localhost:3000` |
| status-page | local `next dev` | `http://localhost:3001` |
| libsql | Docker | `http://localhost:18080` |
| radar-probe-worker | Docker | no public port |

The local web apps read `.env.radar`, then override Docker-only values:

- `DATABASE_URL=http://localhost:18080`
- `NEXT_PUBLIC_URL=http://localhost:3000`
- `NEXT_PUBLIC_STATUS_PAGE_URL=http://localhost:3001`
- `STATUS_PAGE_URL=http://localhost:3001`

Do not print `.env.radar` during normal debugging. Check whether a variable exists instead of echoing secret values.

## Start

Prepare the shared infrastructure and free web ports:

```bash
pnpm dev:radar:prepare
```

Start both web apps with hot reload:

```bash
pnpm dev:radar
```

Open:

- Dashboard: `http://localhost:3000/radar`
- Public status page: `http://localhost:3001/skyhope/zh`

## When To Use Docker Builds

Use Docker for deployment simulation or release checks:

```bash
docker compose -f docker-compose.radar.yaml build dashboard status-page
docker compose -f docker-compose.radar.yaml up -d --no-deps dashboard status-page
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
