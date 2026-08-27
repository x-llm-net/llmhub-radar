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
import { ArrowRight, CheckCircle2, CircleAlert, Clock3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { getProviderPublicURL } from '@/lib/provider-domain'

import type {
  PublicHomeFamily,
  PublicHomeModel,
  PublicHomeProvider,
} from '../types'
import { getFamilyMeta, modelAnchor } from './public-home-family-meta'
import { formatPublicHomeDate } from './public-home-format'
import { PublicHomeStabilityStrip } from './public-home-stability-strip'

function formatStability(provider: PublicHomeProvider) {
  return provider.sample_count > 0
    ? `${provider.stability_7d.toFixed(1)}%`
    : '—'
}

function formatFirstToken(provider: PublicHomeProvider) {
  return provider.first_token_p50_ms !== null
    ? `${provider.first_token_p50_ms.toLocaleString()} ms`
    : '—'
}

function ProviderLogo(props: { provider: PublicHomeProvider }) {
  const identity = props.provider.provider
  return (
    <>
      <span>{identity.name.slice(0, 1).toUpperCase()}</span>
      {identity.logo_url && (
        <img
          src={identity.logo_url}
          alt=''
          loading='lazy'
          onError={(event) => {
            event.currentTarget.hidden = true
          }}
        />
      )}
    </>
  )
}

function ProviderStatus(props: { provider: PublicHomeProvider }) {
  const { t } = useTranslation()
  if (props.provider.online) {
    return (
      <span className='hub-provider-status is-online'>
        <CheckCircle2 aria-hidden='true' />
        {t('Online')}
      </span>
    )
  }
  if (props.provider.sample_count > 0) {
    return (
      <span className='hub-provider-status is-failing'>
        <CircleAlert aria-hidden='true' />
        {t('Currently failing')}
      </span>
    )
  }
  return (
    <span className='hub-provider-status is-pending'>
      <Clock3 aria-hidden='true' />
      {t('Awaiting data')}
    </span>
  )
}

function ProviderRow(props: {
  provider: PublicHomeProvider
  modelName: string
  rank: number
}) {
  const { t } = useTranslation()
  const provider = props.provider

  return (
    <article className='hub-provider-row'>
      <span className='hub-provider-rank'>
        {String(props.rank).padStart(2, '0')}
      </span>
      <a
        className='hub-ranking-provider-identity'
        href={getProviderPublicURL(
          provider.provider.slug,
          provider.provider.public_url
        )}
      >
        <span className='hub-ranking-provider-logo'>
          <ProviderLogo provider={provider} />
        </span>
        <span>
          <strong>{provider.provider.name}</strong>
          <small>
            {t('{{online}}/{{total}} channels online', {
              online: provider.online_channel_count,
              total: provider.channel_count,
            })}
          </small>
        </span>
      </a>
      <PublicHomeStabilityStrip
        timeline={provider.timeline}
        modelName={props.modelName}
      />
      <div className='hub-provider-metrics'>
        <div className='hub-provider-metric'>
          <strong>{formatStability(provider)}</strong>
          <small>
            {t('{{count}} samples', { count: provider.sample_count })}
          </small>
        </div>
        <div className='hub-provider-metric'>
          <strong>{formatFirstToken(provider)}</strong>
          <small>{t('TTFT P50')}</small>
        </div>
        <div className='hub-provider-metric'>
          <strong>{provider.min_price_multiplier.toFixed(2)}×</strong>
          <small>{t('Minimum multiplier')}</small>
        </div>
      </div>
      <ProviderStatus provider={provider} />
      <a
        className='hub-provider-open'
        href={getProviderPublicURL(
          provider.provider.slug,
          provider.provider.public_url
        )}
        aria-label={t('Open {{provider}} homepage', {
          provider: provider.provider.name,
        })}
        title={t('Open provider homepage')}
      >
        <ArrowRight aria-hidden='true' />
      </a>
    </article>
  )
}

function ModelLeaderboard(props: {
  familyKey: string
  model: PublicHomeModel
}) {
  const { t } = useTranslation()
  const model = props.model

  return (
    <article
      className='hub-model-board'
      id={modelAnchor(props.familyKey, model.model_name)}
    >
      <header className='hub-model-board-header'>
        <div>
          <span>{t('MODEL RELIABILITY')}</span>
          <h4>{model.model_name}</h4>
        </div>
        <dl>
          <div>
            <dt>{t('Provider count')}</dt>
            <dd>{model.provider_count}</dd>
          </div>
          <div>
            <dt>{t('Online now')}</dt>
            <dd>{model.online_provider_count}</dd>
          </div>
        </dl>
      </header>

      <div className='hub-provider-list-head' aria-hidden='true'>
        <span>#</span>
        <span>{t('Channel provider')}</span>
        <span>{t('7-day trend')}</span>
        <span className='hub-provider-list-metrics'>
          <span>{t('7-day availability')}</span>
          <span>{t('First-token median')}</span>
          <span>{t('Minimum multiplier')}</span>
        </span>
        <span>{t('Status')}</span>
        <span />
      </div>
      <div>
        {model.providers.slice(0, 10).map((provider, index) => (
          <ProviderRow
            key={provider.provider.slug}
            provider={provider}
            modelName={model.model_name}
            rank={index + 1}
          />
        ))}
      </div>
    </article>
  )
}

export function PublicHomeLeaderboards(props: {
  families: PublicHomeFamily[]
  lastProbeAt: number
}) {
  const { i18n, t } = useTranslation()
  const updatedAt =
    props.lastProbeAt > 0
      ? formatPublicHomeDate(props.lastProbeAt, i18n.language)
      : t('Awaiting first probe')

  return (
    <section
      className='hub-leaderboards'
      id='model-rankings'
      aria-labelledby='model-rankings-title'
    >
      <div className='hub-shell'>
        <div className='hub-leaderboards-heading'>
          <div>
            <p className='hub-section-kicker'>{t('MODEL LEADERBOARDS')}</p>
            <h2 id='model-rankings-title'>
              {t('Reliability rankings by model')}
            </h2>
            <p>
              {t(
                'Higher ranks indicate better recent availability and response speed, based on live probe data rather than provider claims.'
              )}
            </p>
          </div>
          <span className='hub-update-state'>
            <i aria-hidden='true' />
            {t('Latest probe: {{time}}', { time: updatedAt })}
          </span>
        </div>

        <div className='hub-family-leaderboards'>
          {props.families.map((family) => {
            const meta = getFamilyMeta(family.key)
            return (
              <section key={family.key} id={`family-${family.key}`}>
                <div className='hub-family-heading'>
                  <div>
                    <span>{meta.vendor}</span>
                    <h3>{t(meta.title)}</h3>
                  </div>
                  <p>
                    {t('{{count}} published models', {
                      count: family.models.length,
                    })}
                  </p>
                </div>
                <div className='hub-model-board-list'>
                  {family.models.map((model) => (
                    <ModelLeaderboard
                      key={model.model_name}
                      familyKey={family.key}
                      model={model}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </section>
  )
}
