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
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, CheckCircle2, CircleAlert, Clock3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'

import type { ProviderPublicModel } from '../types'
import { getProviderModelId } from '../utils'
import { ProviderModelIcon } from './provider-model-icon'
import { ProviderStabilityStrip } from './provider-stability-strip'

function formatPercent(value: number, sampleCount: number): string {
  return sampleCount > 0 ? `${value.toFixed(1)}%` : '—'
}

function formatLatency(
  value: number | null,
  translate: (key: string) => string
) {
  return value !== null && value >= 0 ? `${value} ms` : translate('No data')
}

function formatAverageLatency(
  value: number,
  translate: (key: string) => string
) {
  return value > 0 ? `${value} ms` : translate('No data')
}

function getModelStatus(
  model: ProviderPublicModel,
  translate: (key: string) => string
) {
  if (model.online) {
    return { Icon: CheckCircle2, label: translate('Online') }
  }
  if (model.sample_count > 0) {
    return { Icon: CircleAlert, label: translate('Degraded') }
  }
  return { Icon: Clock3, label: translate('Awaiting data') }
}

export function ProviderModelRow(props: { model: ProviderPublicModel }) {
  const { t } = useTranslation()
  const model = props.model
  const status = getModelStatus(model, t)
  const StatusIcon = status.Icon
  const validBucketCount = model.timeline.filter(
    (bucket) => bucket.sample_count > 0
  ).length

  return (
    <article
      className='hub-provider-model-card'
      id={getProviderModelId(model.model_name)}
    >
      <header className='hub-provider-model-card-header'>
        <div className='min-w-0'>
          <div className='hub-provider-model-card-title'>
            <ProviderModelIcon modelName={model.model_name} />
            <h3>{model.model_name}</h3>
            <Badge
              variant='outline'
              className={
                model.online
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-muted-foreground'
              }
            >
              <StatusIcon className='size-3' aria-hidden='true' />
              {status.label}
            </Badge>
          </div>
          <p className='hub-provider-model-card-subtitle'>
            {t('{{online}} of {{total}} supply channels online', {
              online: model.online_channel_count,
              total: model.channel_count,
            })}
          </p>
        </div>
        <Link className='hub-provider-model-card-action' to='/pricing'>
          {t('View platform pricing')}
          <ArrowUpRight aria-hidden='true' />
        </Link>
      </header>

      <div className='hub-provider-model-timeline'>
        <div className='hub-provider-model-timeline-label'>
          <span>{t('Recent 7 days')}</span>
          <span>{t('{{count}} samples', { count: model.sample_count })}</span>
        </div>
        <ProviderStabilityStrip
          timeline={model.timeline}
          modelName={model.model_name}
        />
      </div>

      <div className='hub-provider-model-metrics'>
        <div className='hub-provider-model-metric'>
          <strong>
            {formatPercent(model.stability_7d, model.sample_count)}
          </strong>
          <span>{t('7-day stability')}</span>
        </div>
        <div className='hub-provider-model-metric'>
          <strong>{formatLatency(model.first_token_p50_ms, t)}</strong>
          <span>{t('TTFT P50')}</span>
        </div>
        <div className='hub-provider-model-metric'>
          <strong>{formatLatency(model.first_token_p95_ms, t)}</strong>
          <span>{t('TTFT P95')}</span>
        </div>
        <div className='hub-provider-model-metric'>
          <strong>{formatAverageLatency(model.average_latency_ms, t)}</strong>
          <span>{t('Average latency')}</span>
        </div>
        <div className='hub-provider-model-metric'>
          <strong>{`${validBucketCount}/${model.timeline.length || 28}`}</strong>
          <span>{t('Data coverage')}</span>
        </div>
        <div className='hub-provider-model-metric'>
          <strong>
            {model.min_price_multiplier > 0
              ? `${model.min_price_multiplier.toFixed(2)}x`
              : '—'}
          </strong>
          <span>{t('From multiplier')}</span>
        </div>
      </div>
    </article>
  )
}
