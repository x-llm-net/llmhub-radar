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
import { CheckCircle2, CircleAlert, Clock3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ProviderPublicModel } from '../types'
import { getProviderModelId } from '../utils'
import { ProviderModelIcon } from './provider-model-icon'
import { ProviderStabilityStrip } from './provider-stability-strip'

function formatPercent(value: number, sampleCount: number): string {
  return sampleCount > 0 ? `${value.toFixed(2)}%` : '—'
}

function formatDuration(
  value: number | null,
  translate: (key: string) => string
): string {
  if (value === null || value < 0) return translate('No data')
  if (value < 1000) return `${Math.round(value)} ms`
  const seconds = value / 1000
  return `${seconds < 10 ? seconds.toFixed(1) : seconds.toFixed(0)} s`
}

function formatProbeTime(timestamp: number, language: string): string {
  if (timestamp <= 0) return '—'
  const locale =
    language === 'zhCN' ? 'zh-CN' : language === 'zhTW' ? 'zh-TW' : language
  return new Date(timestamp * 1000).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getModelStatus(
  model: ProviderPublicModel,
  translate: (key: string) => string
) {
  if (
    model.online_channel_count > 0 &&
    model.online_channel_count < model.channel_count
  ) {
    return {
      Icon: CircleAlert,
      label: translate('Partially available'),
      className: 'is-partial',
    }
  }
  if (model.online) {
    return {
      Icon: CheckCircle2,
      label: translate('Online'),
      className: 'is-online',
    }
  }
  if (model.sample_count > 0) {
    return {
      Icon: CircleAlert,
      label: translate('Currently failing'),
      className: 'is-failing',
    }
  }
  return {
    Icon: Clock3,
    label: translate('Awaiting data'),
    className: 'is-pending',
  }
}

export function ProviderModelCard(props: { model: ProviderPublicModel }) {
  const { i18n, t } = useTranslation()
  const model = props.model
  const status = getModelStatus(model, t)
  const StatusIcon = status.Icon

  return (
    <article
      className='hub-provider-model-compact-card'
      id={getProviderModelId(model.model_name)}
    >
      <header className='hub-provider-model-compact-header'>
        <div className='hub-provider-model-compact-title'>
          <ProviderModelIcon modelName={model.model_name} />
          <div>
            <h3>{model.model_name}</h3>
            <p>
              {t('{{online}} of {{total}} supply channels online', {
                online: model.online_channel_count,
                total: model.channel_count,
              })}
              <span aria-hidden='true'> · </span>
              {model.min_price_multiplier > 0
                ? `${t('From multiplier')} ${model.min_price_multiplier.toFixed(2)}x`
                : t('No data')}
            </p>
          </div>
        </div>
        <span
          className={`hub-provider-model-compact-status ${status.className}`}
        >
          <StatusIcon aria-hidden='true' />
          {status.label}
        </span>
      </header>

      <dl className='hub-provider-model-compact-metrics'>
        <div>
          <dt>{t('7-day stability')}</dt>
          <dd>{formatPercent(model.stability_7d, model.sample_count)}</dd>
        </div>
        <div>
          <dt>{t('TTFT P50')}</dt>
          <dd>{formatDuration(model.first_token_p50_ms, t)}</dd>
        </div>
        <div>
          <dt>{t('TTFT P95')}</dt>
          <dd>{formatDuration(model.first_token_p95_ms, t)}</dd>
        </div>
      </dl>

      <div className='hub-provider-model-compact-timeline'>
        <div>
          <span>{t('Recent 7 days')}</span>
          <span>{t('{{count}} samples', { count: model.sample_count })}</span>
        </div>
        <ProviderStabilityStrip
          timeline={model.timeline}
          modelName={model.model_name}
          className='hub-provider-model-compact-strip'
        />
        <div className='hub-provider-model-compact-range' aria-hidden='true'>
          <span>{t('Past')}</span>
          <span>{t('Now')}</span>
        </div>
      </div>

      <footer className='hub-provider-model-compact-footer'>
        <span>
          <Clock3 aria-hidden='true' />
          {t('Average latency')}: {formatDuration(model.average_latency_ms, t)}
        </span>
        <span>
          {t('Last probe')}:{' '}
          {formatProbeTime(model.last_probe_at, i18n.language)}
        </span>
      </footer>
    </article>
  )
}
