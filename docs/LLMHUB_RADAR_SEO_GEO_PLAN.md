# LLMHub Radar SEO/GEO Technical Plan

Date: 2026-08-01

## Goal

Make LLMHub Radar discoverable in Google Search and answer engines by turning its
live probe data into indexable, machine-readable, citation-friendly pages.

This plan treats SEO and GEO as a product/data layer, not a content farm. The
main advantage of Radar is fresh observed data: provider status, model
availability, first-token latency, sample count, ranking rules, and update time.

## Definitions

- SEO: Google/Bing-style organic search visibility.
- GEO: Generative Engine Optimization for ChatGPT, Gemini, Perplexity, Google AI
  Overviews/AI Mode, and similar answer engines.
- Programmatic SEO: structured pages generated from real data, such as model
  rankings and provider status pages.

## Principles

1. Data pages first, articles second.
2. Every indexable page must have unique data, update time, and a clear purpose.
3. Visible page content, JSON-LD, markdown, and JSON endpoints must describe the
   same facts.
4. Do not make low-value keyword doorway pages.
5. Avoid exposing private API keys, raw probe evidence, or non-public providers.
6. Keep generated pages fast and cacheable.

## Current Baseline

Already present:

- Public status page `robots.ts` and `sitemap.ts`.
- Canonical and alternate links for public status pages.
- Markdown representation through `.md` and `Accept: text/markdown`.
- Agent discovery through per-page `llms.txt`.
- Statuspage-compatible JSON endpoints:
  - `/api/status/summary.json`
  - `/api/status/current.json`
  - `/api/status/incidents.json`
- Marketplace provider query API for public ranking data.

Main gaps:

- Public marketplace/home/model pages need page-specific metadata.
- Sitemap does not yet cover marketplace model/provider/ranking pages as a
  first-class SEO surface.
- JSON-LD is missing for Radar marketplace and ranking entities.
- GEO-readable ranking rules and data source summaries are not centralized.
- AI visibility tracking is not yet measured.

## Page Inventory

### Indexable

- Home/ranking page: `https://llm-hub.store/`
- Model ranking page: `/model.html?model={modelSlug}` today; preferably migrate
  to clean routes later, such as `/models/{modelSlug}`.
- Provider page/status page: `/{providerSlug}` and `/{providerSlug}/{locale}`.
- Developer API page: `/developers/api`.
- Machine-readable documents:
  - `/llms.txt`
  - `/{providerSlug}/{locale}/llms.txt`
  - `/{providerSlug}/.md`
  - JSON status endpoints.

### Noindex

- Embed variants.
- Login, verify, unsubscribe, manage pages.
- Dashboard/admin pages.
- Non-public or gated provider pages.
- Query-only filter combinations that do not represent a stable page.

## Technical Work

### Phase 1: Foundation

Scope:

- Add or improve metadata for public marketplace pages:
  - title
  - description
  - canonical
  - Open Graph
  - Twitter card
  - robots
- Generate sitemap entries for:
  - home
  - developer API
  - public provider pages
  - model ranking pages
- Add JSON-LD:
  - `Organization` for LLMHub Radar
  - `WebSite` for search/discovery
  - `ItemList` for rankings
  - `Dataset` for observed probe/ranking data
  - `BreadcrumbList` for provider/model detail pages
- Add a visible "ranking rules and data source" section on ranking/model pages.
- Make `llms.txt` summarize public marketplace data entry points.

Likely code areas:

- `apps/storefront/index.html`
- `apps/storefront/model.html`
- `apps/storefront/provider.html`
- `apps/storefront/main.js`
- `apps/storefront/model-page.js`
- `apps/storefront/provider-page.js`
- `apps/marketplace-api/src/app.ts`
- `packages/marketplace-db/src/repository.ts`
- `infra/Caddyfile.radar.example`
- `apps/status-page/src/app/(public)/developers/api/page.tsx`

Estimate:

- Engineering: 2-4 days.
- Design/content review: 0.5-1 day.
- Risk: low to medium. Mostly metadata and public read paths.

Implementation status (2026-08-01): implemented locally. Production release,
rendered structured-data validation, and Search Console sitemap submission are
still pending.

### Phase 2: Clean Model/Provider SEO Routes

Scope:

- Add clean routes:
  - `/models/{modelSlug}`
  - `/providers/{providerSlug}`
  - optional `/rankings/{modelSlug}` if model detail and ranking should split.
- Keep existing `model.html?model=...` working.
- Add canonical from old query URLs to clean routes.
- Create model page copy blocks:
  - current best providers
  - 7-day availability
  - first-token latency
  - sample count
  - last updated time
  - ranking rule explanation
- Add markdown/JSON variants:
  - `/models/{modelSlug}.md`
  - `/models/{modelSlug}.json`

Estimate:

- Engineering: 4-7 days.
- Design/content review: 1-2 days.
- Risk: medium. Route changes need careful canonical/redirect behavior.

### Phase 3: GEO Measurement Loop

Scope:

- Define 25-50 prompts to track, for example:
  - "best GPT-5 API provider"
  - "Claude Sonnet API provider reliability"
  - "LLM API status page"
  - "OpenAI compatible API provider ranking"
  - "which AI API relay is stable"
- Track brand/entity mentions:
  - LLMHub Radar
  - llm-hub.store
  - x-llm
  - known provider names
- Track citation URLs, not just mentions.
- Record weekly results in a simple report.

Estimate:

- Setup: 0.5-1 day.
- Weekly review: 1-2 hours.
- Risk: low.

### Phase 4: External Authority

Scope:

- Publish API docs and public dataset explanation.
- Create 5-10 high-signal explainer pages:
  - "How LLMHub Radar ranks LLM API providers"
  - "What 7-day API availability means"
  - "How to compare first-token latency across LLM providers"
  - "OpenAI-compatible API provider monitoring"
- Seed legitimate external mentions:
  - GitHub README/docs
  - developer communities
  - comparison/monitoring directories
  - short demo videos or posts

Estimate:

- Engineering: 1-2 days for docs surfaces.
- Content: 3-7 days depending on depth.
- Risk: low, if content stays factual.

## Tooling And Cost

### Free

- Google Search Console: indexing, queries, sitemap status, crawl errors.
- Google Rich Results Test: structured data validation.
- PageSpeed Insights: Core Web Vitals and performance checks.
- Browser/dev tools or Playwright checks for rendered metadata.

Monthly cost: $0.

### Low-Cost Trial

- Semrush AI Visibility Toolkit.
  - Current public pricing: from `$99/mo per domain`.
  - Useful for ChatGPT, Google AI, Gemini, Perplexity mentions, prompt tracking,
    AI readiness audit, and competitor comparison.
  - Recommended use: one-month trial after Phase 1 ships.

Monthly cost: about $99 for one domain.

### Optional Later

- Ahrefs.
  - Lite plan currently starts around `£99/mo`.
  - Brand Radar AI add-on currently starts around `£159/mo`, or standalone AI
    platform access from about `$199/mo` depending on plan/region.
  - Custom prompt packages start lower and can be used once prompts are stable.
- Screaming Frog SEO Spider.
  - Free for up to 500 URLs.
  - Paid license is useful later for larger crawls and structured-data audits.

Recommended first 60-day cash cost:

- Month 1: $0, use free Google tools.
- Month 2: $99, add Semrush AI Visibility for one month.
- Defer Ahrefs until we have enough indexed pages and external mentions.

## Internal Metrics

Track weekly:

- Indexed pages count.
- Sitemap discovered/submitted pages.
- Search impressions and clicks by page type.
- Queries containing:
  - model names
  - provider names
  - "API status"
  - "API stability"
  - "LLM API provider"
- AI prompt visibility:
  - mentioned or not
  - cited URL
  - sentiment
  - competitor names mentioned
- Page freshness:
  - last ranking sync time
  - last probe sample time

## Acceptance Criteria

Phase 1 is done when:

- Public pages have unique metadata and canonical URLs.
- Sitemap includes all intended indexable public pages.
- Robots does not index private/embed/admin pages.
- JSON-LD validates without critical errors.
- `llms.txt` points agents to ranking, model, provider, and API data.
- Search Console sitemap submission succeeds.

Phase 2 is done when:

- Clean model/provider routes are live.
- Old query URLs remain usable and canonicalize correctly.
- Model pages expose both human-readable and machine-readable summaries.
- No duplicate-title/duplicate-description warnings for core pages.

## Decisions And Open Questions

- Public metadata is Chinese-first for the current 2C audience.
- `llm-hub.store` is the public marketplace brand; `app.llm-hub.store` remains
  the authenticated owner dashboard.
- Phase 1 keeps `model.html?model=...` and `provider.html?slug=...` working;
  clean route migration remains Phase 2.
- The remaining planning question is which competitors to track in AI
  visibility tools after Search Console starts collecting baseline data.

## Recommendation

Start with Phase 1 immediately. It is small, low-risk, and improves both Google
SEO and GEO foundations. Do not pay for expensive AI visibility tools until
after Phase 1 is live and Search Console has started collecting data.
