# Marketplace data foundation

This package is the greenfield data layer for the model-specific provider
leaderboards. The existing Radar worker remains the probe authority during the
first phase; an idempotent adapter imports each public status page's model
buckets and recent checks into PostgreSQL without database access or secrets.

## Ranking unit

`provider_models` is the stable public ranking unit: one provider and one
canonical model. The MVP allows one active scoring target for each ranking
unit. Additional API keys or routes may exist as diagnostic targets but do not
change the score.

## Scoring

- A scheduled primary probe is the scoring event.
- Retries use `attempt_no > 0` and never change availability.
- Provider failures enter the denominator.
- Configuration and observer errors do not enter the denominator.
- Current configuration errors and stale data suspend natural-rank eligibility.
- The public score uses the latest 56 completed UTC-aligned three-hour buckets.
- A provider/model pair enters the natural ranking after at least 4 scoreable
  probe samples. Successes and provider failures both count as scoreable
  samples; configuration and observer errors do not.
- There is no minimum availability gate. Low-availability providers remain
  visible and rank naturally by measured availability.
- Grades are S >= 98%, A >= 95%, B >= 90%, C >= 80%, and D below 80%.

Scores are stored as integer basis points. `9990` means `99.90%`. `0` is a
measured zero score; `NULL` means there is not enough scoreable data.

## Retention

- `probe_checks`: 30 days.
- `health_buckets_3h`: 13 months.
- Current stats and catalog data: retained while the listing exists.

## Model lifecycle

- Radar credentials discover model IDs from the provider's authenticated
  OpenAI-compatible `/v1/models` endpoint.
- A model is public only when it has an enabled scoring target attached to a
  published provider listing in `observing` or `ranked` state. A row in
  `models` by itself never creates a storefront tab.
- Unknown target model IDs are inserted into `models` automatically. The table
  remains the canonical place for aliases, display metadata and ordering, but
  production startup does not seed a built-in model list.
- `/v1/models` is called only when a credential is added or edited so the user
  can select a probe model. The scheduled worker does not refresh catalogs.
- A target is hidden from Marketplace after three consecutive probe responses
  report `model_not_found`, but Radar continues its normal ten-minute probes.
  After twelve consecutive responses it retires the target and stops probing.
  Any successful probe or different error clears the counter, and a hidden
  listing returns to observation automatically. Editing the credential also
  re-enables a retired target. Historical checks and model metadata are kept.
- `models.visibility` defaults to `auto`. Database operators may use `show` for
  an explicit global exception or `hide` to suppress a model. Historical rows
  are retained in every mode.

Run `pnpm --filter @llmhub/marketplace-db cleanup` from a daily scheduler. It
deletes in bounded batches until all expired rows are gone, avoiding one large
table lock without leaving a permanent retention backlog.

## Public API

- `GET /health`
- `GET /v1/models`
- `GET /v1/models/:slug/leaderboard`
- `GET /v1/providers/:slug/rankings`
- `GET /v1/homepage`

Leaderboard responses return `sponsored`, `ranking`, and `observing` as
separate arrays. `observing` exposes real aggregate evidence and the
qualification reason without assigning a grade or natural rank. Natural
ranking queries never join the sponsorship table. Public responses use a
process-local request-collapse cache plus shared HTTP/CDN caching, ETag,
stale-while-revalidate, and stale-if-error. Cache TTLs stop at the next ten-minute boundary.
The provider rankings endpoint keeps each model's natural rank relative to the
full eligible leaderboard, including when the provider is outside the public
Top 10. The authenticated Dashboard uses this endpoint only after filtering to
provider slugs visible to the current account.
Provider models whose latest primary check is older than 30 minutes are omitted
from both ranking and observation results, even if a maintenance process has
recently recomputed their materialized stats.

## Local verification

```powershell
docker compose -f docker-compose.marketplace.yaml up -d postgres
$env:MARKETPLACE_DATABASE_URL='postgres://llmhub:llmhub@127.0.0.1:55432/llmhub_marketplace'
pnpm --filter @llmhub/marketplace-db migrate
pnpm --filter @llmhub/marketplace-api dev
```

The API is available at `http://127.0.0.1:3010` by default. Integration tests
require a separate PostgreSQL database whose name contains `test`, exposed
through `MARKETPLACE_TEST_DATABASE_URL`. CI creates and migrates that database
before running both Marketplace test suites.

To sync the existing public Radar pages, run:

```powershell
$env:MARKETPLACE_DATABASE_URL='postgres://llmhub:llmhub@127.0.0.1:55432/llmhub_marketplace'
$env:MARKETPLACE_LEGACY_PUBLIC_URL='https://llm-hub.store'
pnpm --filter @llmhub/marketplace-db sync:legacy
```

The first enabled legacy target for each provider/model pair is the scoring
target. Other groups are imported as non-scoring evidence targets. Changing
the primary target should become an explicit owner action in the dashboard.
When no explicit slug list is passed to the sync function, the adapter first
loads the public Radar directory and imports every public, opt-in status page.
Unknown model names are automatically created in PostgreSQL with rule-based
display metadata. `packages/marketplace-db/src/model-metadata.ts` renders
`gpt-*` as `GPT`, title-cases other hyphenated tokens, joins numeric version
tokens with dots, and sorts marketplace lists by family plus descending model
version inside each relevant series. Database metadata should only be needed for
true display or grouping exceptions.

The adapter reuses only public Radar outputs. API keys, endpoint URLs and
ciphertext stay in the existing Radar database and worker. The storefront
loads `/v1/homepage` and never loads the mock fixture.

Production runs `sync:legacy` every ten minutes through the
`marketplace-maintenance` service, matching the public Radar refresh cadence.
The same service runs retention cleanup once per day. The sync command is
idempotent: repeated public checks are ignored and each run refreshes the
affected provider-model materialized stats.

Legacy coverage keeps the configured interval as its upper bound and uses the
upper quartile of non-empty historical bucket sample counts as the compatibility
expectation. This tolerates normal 10-minute scheduler drift without hiding
empty or substantially incomplete buckets. Historical public buckets still do
not expose typed error categories, so historical `error` counts are treated as
provider failures. A
current configuration error still suspends ranking. Native Marketplace probes
retain typed error handling and individual scheduled attempts.

Production Compose includes PostgreSQL, a one-shot migration, the Marketplace
API, and the maintenance loop. Caddy routes `/v1/*` to the API
on loopback port `3010`; all other `llm-hub.store` traffic continues to the
status-page service.

## Deferred work

- Add Redis only when the API runs more than one replica or database profiling
  shows the process-local cache is insufficient.
- Add database exclusion rules for overlapping sponsorship windows when the
  sponsorship management workflow is implemented.
- Replace the remaining provider/listing upserts with bulk staging only after
  real sync profiling shows they exceed the ten-minute window.
- Make the owner-selected scoring target explicit in the dashboard before
  providers manage multiple ranking groups directly in Marketplace.
- Add a small admin UI for editing optional model metadata and visibility if
  direct database edits become too slow.
- If a benchmark site offers allowed public access or an official API, consider
  a secondary benchmark score from places such as hvoy.ai, veridrop, or cctest,
  but keep it clearly separate from live probe stability and label the source.
