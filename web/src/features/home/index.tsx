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

import { useSystemConfig } from '@/hooks/use-system-config'

import { getPublicHome } from './api'
import { PublicHomeFamilyNav } from './components/public-home-family-nav'
import { PublicHomeHeader } from './components/public-home-header'
import { PublicHomeHero } from './components/public-home-hero'
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
  const { systemName } = useSystemConfig()
  const brandName = systemName || 'LLMHub'
  const query = useQuery({
    queryKey: ['hub-public-home'],
    queryFn: getPublicHome,
    retry: false,
    staleTime: 60 * 1000,
  })

  useEffect(() => {
    let description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]'
    )
    if (!description) {
      description = document.createElement('meta')
      description.name = 'description'
      document.head.appendChild(description)
    }
    description.content = t(
      'Continuously test mainstream models from different providers, comparing seven-day availability, first-token latency, and current status so every choice has evidence.'
    )
  }, [t])

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
        <PublicHomeHero home={home} />

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
              <p className='hub-section-kicker'>{t('MODEL LEADERBOARDS')}</p>
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
              <p className='hub-section-kicker'>{t('HOW TO READ')}</p>
              <h2 id='ranking-rules-title'>{t('How to read the rankings')}</h2>
              <p>
                {t(
                  'Each model is ranked independently. Start with the seven-day trend and availability, then compare first-token median and sample coverage. Different endpoint types use metrics suited to their response patterns.'
                )}
              </p>
            </div>
            <div className='hub-rule-list'>
              <article>
                <span>01</span>
                <h3>{t('Read the seven-day trend')}</h3>
                <p>
                  {t(
                    'The blocks run from oldest to newest: green means successful probes, red means failures, and gray means no data.'
                  )}
                </p>
              </article>
              <article>
                <span>02</span>
                <h3>{t('Multidimensional quality assessment')}</h3>
                <p>
                  {t(
                    'The system evaluates recent availability, first-token response, tail latency, and sample confidence, with adjustments for insufficient data or sustained anomalies.'
                  )}
                </p>
              </article>
              <article>
                <span>03</span>
                <h3>{t('How to read first-token time')}</h3>
                <p>
                  {t(
                    'First-token time (TTFT) runs from request start to the first valid output; lower is better. P50 means half of requests are faster, while P95 reveals occasional slow responses.'
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
            <div className='hub-provider-cta-heading'>
              <p className='hub-section-kicker'>{t('OPEN YOUR STORE')}</p>
              <h2 id='provider-onboarding-title'>
                {t('Turn your relay or API channel into a business')}
              </h2>
              <p>
                {t(
                  'Already run a relay? Connect it to reach more users. Only have a reliable API channel? Open your store here without building a relay website or account pool.'
                )}
              </p>
            </div>

            <div className='hub-provider-cta-path'>
              <ol>
                <li>
                  <span>01</span>
                  <strong>{t('Create your store')}</strong>
                  <small>
                    {t('Set up your provider profile and public homepage.')}
                  </small>
                </li>
                <li>
                  <span>02</span>
                  <strong>{t('Connect your relay or channel')}</strong>
                  <small>
                    {t(
                      'Bring an existing relay service or supply a reliable API channel directly.'
                    )}
                  </small>
                </li>
                <li>
                  <span>03</span>
                  <strong>{t('Publish and earn')}</strong>
                  <small>
                    {t('Pass testing, serve users, and earn from real usage.')}
                  </small>
                </li>
              </ol>
              <a href='/provider/onboarding'>
                {t('Open your store for free')}
                <ArrowRight aria-hidden='true' />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className='hub-footer'>
        <div className='hub-shell'>
          <div>
            <strong>{brandName}</strong>
            <span>{t('AI relay reliability rankings')}</span>
          </div>
          <nav aria-label={t('Footer navigation')}>
            <a href='#model-rankings'>{t('Model rankings')}</a>
            <a href='#ranking-rules'>{t('Ranking rules')}</a>
            <a href='#provider-onboarding'>{t('Become a channel provider')}</a>
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
