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
import { Activity, ArrowDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useSystemConfig } from '@/hooks/use-system-config'
import { getProviderPublicURL } from '@/lib/provider-domain'

import type { PublicHomeData, PublicHomeProvider } from '../types'
import { formatPublicHomeDate } from './public-home-format'

type FastestModel = {
  modelName: string
  provider: PublicHomeProvider
}

function getFastestModels(home: PublicHomeData): FastestModel[] {
  const fastestByModel = new Map<string, FastestModel>()

  for (const family of home.families) {
    for (const model of family.models) {
      for (const provider of model.providers) {
        if (!provider.online || provider.first_token_p50_ms === null) continue

        const current = fastestByModel.get(model.model_name)
        if (
          !current ||
          provider.first_token_p50_ms <
            (current.provider.first_token_p50_ms ?? Number.POSITIVE_INFINITY)
        ) {
          fastestByModel.set(model.model_name, {
            modelName: model.model_name,
            provider,
          })
        }
      }
    }
  }

  return [...fastestByModel.values()]
    .sort(
      (left, right) =>
        (left.provider.first_token_p50_ms ?? Number.POSITIVE_INFINITY) -
        (right.provider.first_token_p50_ms ?? Number.POSITIVE_INFINITY)
    )
    .slice(0, 3)
}

function formatFirstToken(milliseconds: number) {
  const seconds = milliseconds / 1000
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`
}

export function PublicHomeHero(props: { home: PublicHomeData }) {
  const { i18n, t } = useTranslation()
  const { systemName } = useSystemConfig()
  const brandName = systemName || 'LLMHub'
  const fastestModels = getFastestModels(props.home)
  const lastProbeLabel =
    props.home.last_probe_at > 0
      ? formatPublicHomeDate(props.home.last_probe_at, i18n.language)
      : t('Awaiting data')
  const observationCount = props.home.families.reduce(
    (familyTotal, family) =>
      familyTotal +
      family.models.reduce(
        (modelTotal, model) =>
          modelTotal +
          model.providers.reduce(
            (providerTotal, provider) => providerTotal + provider.sample_count,
            0
          ),
        0
      ),
    0
  )

  return (
    <section className='hub-hero'>
      <div className='hub-shell hub-hero-grid'>
        <div className='hub-hero-copy'>
          <p className='hub-hero-eyebrow'>
            <span aria-hidden='true' />
            {t('{{count}} providers are under continuous testing', {
              count: props.home.provider_count,
            })}
          </p>
          <h1>
            <span>{brandName}</span>
            <strong>{t('AI API relay field-test rankings')}</strong>
          </h1>
          <p className='hub-hero-lede'>
            {t(
              'Continuously test mainstream models from different providers, comparing seven-day availability, first-token latency, and current status so every choice has evidence.'
            )}
          </p>
          <div className='hub-hero-actions'>
            <a className='hub-primary-button' href='#model-rankings'>
              {t('View model rankings')}
              <ArrowDown aria-hidden='true' />
            </a>
            <a className='hub-secondary-button' href='#ranking-rules'>
              {t('How rankings work')}
              <Activity aria-hidden='true' />
            </a>
          </div>
        </div>

        <aside className='hub-fastest' aria-labelledby='hub-fastest-title'>
          <div className='hub-fastest-heading'>
            <h2 id='hub-fastest-title'>{t('Fastest right now')}</h2>
            <span>
              {t('Last probe')} · {lastProbeLabel}
            </span>
          </div>

          {fastestModels.length > 0 ? (
            <ol className='hub-fastest-list'>
              {fastestModels.map((entry, index) => (
                <li key={entry.modelName}>
                  <span className='hub-fastest-rank'>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <a
                    href={getProviderPublicURL(
                      entry.provider.provider.slug,
                      entry.provider.provider.public_url
                    )}
                  >
                    <strong>{entry.modelName}</strong>
                    <small>
                      {entry.provider.provider.name} ·{' '}
                      {entry.provider.min_price_multiplier.toFixed(2)}× ·{' '}
                      {entry.provider.stability_7d.toFixed(1)}%
                    </small>
                  </a>
                  <span className='hub-fastest-time'>
                    <strong>
                      {formatFirstToken(entry.provider.first_token_p50_ms ?? 0)}
                    </strong>
                    <small>{t('First-token median')}</small>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className='hub-fastest-empty'>{t('Awaiting data')}</p>
          )}
        </aside>
      </div>

      <div className='hub-trust-strip'>
        <div className='hub-shell hub-trust-grid'>
          <div className='hub-trust-intro'>
            <strong>{t('Transparent system status')}</strong>
            <p>
              {t(
                'Rankings combine platform probes with real request observations.'
              )}
            </p>
          </div>
          <dl>
            <div>
              <dt>{t('Covered providers')}</dt>
              <dd>{props.home.provider_count.toLocaleString()}</dd>
            </div>
            <div>
              <dt>{t('Published models')}</dt>
              <dd>{props.home.published_model_count.toLocaleString()}</dd>
            </div>
            <div>
              <dt>{t('Model observations')}</dt>
              <dd>{observationCount.toLocaleString()}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  )
}
