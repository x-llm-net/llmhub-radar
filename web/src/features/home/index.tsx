/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { getPublicHome } from './api'
import { PublicHomeFamilyNav } from './components/public-home-family-nav'
import { PublicHomeHeader } from './components/public-home-header'
import { PublicHomeLeaderboards } from './components/public-home-leaderboards'

import './public-home.css'

function PublicHomeLoading() {
  const { t } = useTranslation()
  return (
    <div className='llmhub-home'>
      <PublicHomeHeader />
      <main
        className='hub-shell hub-loading'
        aria-label={t('Loading rankings')}
      >
        <div className='hub-loading-line is-short' />
        <div className='hub-loading-line is-title' />
        <div className='hub-loading-line is-copy' />
        <div className='hub-loading-stats'>
          <div />
          <div />
        </div>
        <div className='hub-loading-cards'>
          <div />
          <div />
          <div />
          <div />
        </div>
      </main>
    </div>
  )
}

function PublicHomeError(props: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className='llmhub-home'>
      <PublicHomeHeader />
      <main className='hub-shell hub-error-state'>
        <span>{t('Rankings are temporarily unavailable')}</span>
        <h1>{t('Probe data could not be loaded')}</h1>
        <p>
          {t(
            'The public rankings endpoint did not return usable data. Please try again.'
          )}
        </p>
        <button type='button' onClick={props.onRetry}>
          <RefreshCw aria-hidden='true' />
          {t('Retry')}
        </button>
      </main>
    </div>
  )
}

export function Home() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['hub-public-home'],
    queryFn: getPublicHome,
    retry: false,
    staleTime: 60 * 1000,
  })

  useEffect(() => {
    document.title = 'LLMHub | AI API 中转站实测榜'
    let description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]'
    )
    if (!description) {
      description = document.createElement('meta')
      description.name = 'description'
      document.head.appendChild(description)
    }
    description.content =
      '持续测试不同 AI API 中转站的模型可用率、响应延迟与近期状态。'
  }, [])

  if (query.isLoading) return <PublicHomeLoading />
  if (query.isError || !query.data?.data) {
    return <PublicHomeError onRetry={() => void query.refetch()} />
  }

  const home = query.data.data
  const hasRankings = home.families.length > 0

  return (
    <div className='llmhub-home'>
      <PublicHomeHeader />

      <main id='top'>
        <section className='hub-hero'>
          <div className='hub-shell'>
            <p className='hub-hero-eyebrow'>
              {t('STABILITY AND LATENCY, CONTINUOUSLY TESTED')}
            </p>
            <h1>{t('AI API relay field-test rankings')}</h1>
            <p className='hub-hero-lede'>
              {t(
                'Continuously test mainstream models from different providers, comparing seven-day availability, first-token latency, and current status so every choice has evidence.'
              )}
            </p>
            <div className='hub-hero-actions'>
              <a className='hub-primary-button' href='#model-rankings'>
                {t('View model rankings')}
                <ArrowRight aria-hidden='true' />
              </a>
              <a className='hub-secondary-button' href='#ranking-rules'>
                {t('How rankings work')}
              </a>
            </div>

            <dl className='hub-hero-facts'>
              <div>
                <dt>{t('Covered providers')}</dt>
                <dd>
                  {t('{{count}} providers', { count: home.provider_count })}
                </dd>
              </div>
              <div>
                <dt>{t('Published models')}</dt>
                <dd>
                  {t('{{count}} models', { count: home.published_model_count })}
                </dd>
              </div>
              <div>
                <dt>{t('Probe frequency')}</dt>
                <dd>{t('10 min text · 30 min image')}</dd>
              </div>
            </dl>

            <div className='hub-ranking-note'>
              <strong>{t('Only real probe data is used.')}</strong>
              <span>
                {t(
                  'Unpublished models are hidden. Published models remain visible when they are currently failing.'
                )}
              </span>
            </div>
          </div>
        </section>

        {hasRankings ? (
          <>
            <PublicHomeFamilyNav families={home.families} />
            <PublicHomeLeaderboards
              families={home.families}
              lastProbeAt={home.last_probe_at}
            />
          </>
        ) : (
          <section className='hub-empty-rankings'>
            <div className='hub-shell'>
              <p className='hub-section-kicker'>MODEL LEADERBOARDS</p>
              <h2>{t('The first published model will appear here')}</h2>
              <p>
                {t(
                  'Providers can publish a model after its connection has been tested successfully.'
                )}
              </p>
            </div>
          </section>
        )}

        <section
          className='hub-rules'
          id='ranking-rules'
          aria-labelledby='ranking-rules-title'
        >
          <div className='hub-shell'>
            <div className='hub-rules-heading'>
              <p className='hub-section-kicker'>HOW TO READ</p>
              <h2 id='ranking-rules-title'>{t('How to read the rankings')}</h2>
              <p>
                {t(
                  'A comprehensive score combines availability, first-token speed, and evidence coverage; endpoints without TTFT use availability and confidence.'
                )}
              </p>
            </div>
            <div className='hub-rule-list'>
              <article>
                <span>01</span>
                <h3>{t('Compare the exact model')}</h3>
                <p>
                  {t(
                    'Each model is ranked independently instead of averaging an entire provider.'
                  )}
                </p>
              </article>
              <article>
                <span>02</span>
                <h3>{t('Comprehensive score')}</h3>
                <p>
                  {t(
                    'Availability contributes 80%, TTFT P50 10%, TTFT P95 5%, and sample confidence 5%.'
                  )}
                </p>
              </article>
              <article>
                <span>03</span>
                <h3>{t('Balance pauses lose rank gradually')}</h3>
                <p>
                  {t(
                    'Insufficient-quota probes do not reduce availability; a continuous pause ramps to a 10% penalty over seven days.'
                  )}
                </p>
              </article>
            </div>
          </div>
        </section>

        <section
          className='hub-provider-cta'
          id='provider-onboarding'
          aria-labelledby='provider-onboarding-title'
        >
          <div className='hub-shell'>
            <div>
              <p className='hub-section-kicker'>FOR PROVIDERS</p>
              <h2 id='provider-onboarding-title'>
                {t('Put your real service quality on the board')}
              </h2>
              <p>
                {t(
                  'Create a provider profile, connect supply channels, test models, and publish only the models you want to sell.'
                )}
              </p>
            </div>
            <a href='/provider/onboarding'>
              {t('Become a channel provider')}
              <ArrowRight aria-hidden='true' />
            </a>
          </div>
        </section>
      </main>

      <footer className='hub-footer'>
        <div className='hub-shell'>
          <div>
            <strong>LLMHub</strong>
            <span>{t('AI relay reliability rankings')}</span>
          </div>
          <nav aria-label={t('Footer navigation')}>
            <a href='#model-rankings'>{t('Model rankings')}</a>
            <a href='#ranking-rules'>{t('Ranking rules')}</a>
            <a href='#provider-onboarding'>{t('Provider onboarding')}</a>
          </nav>
          <small>
            {t(
              'Probe results describe past observations and do not guarantee future availability.'
            )}
          </small>
        </div>
      </footer>
    </div>
  )
}
