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
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import type { ProviderPublicBucket } from '../types'

function bucketClass(status: ProviderPublicBucket['status']): string {
  switch (status) {
    case 'available':
      return 'bg-emerald-500 dark:bg-emerald-400'
    case 'degraded':
      return 'bg-amber-400 dark:bg-amber-300'
    case 'error':
      return 'bg-rose-500 dark:bg-rose-400'
    default:
      return 'bg-muted-foreground/20'
  }
}

function bucketLabel(
  status: ProviderPublicBucket['status'],
  translate: (key: string) => string
): string {
  switch (status) {
    case 'available':
      return translate('Available')
    case 'degraded':
      return translate('Degraded')
    case 'error':
      return translate('Error')
    default:
      return translate('No recent data')
  }
}

function formatBucketStartedAt(timestamp: number): string {
  if (timestamp <= 0) return ''
  return new Date(timestamp * 1000).toLocaleString()
}

export function ProviderStabilityStrip(props: {
  timeline: ProviderPublicBucket[]
  modelName: string
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <TooltipProvider>
      <div
        className={cn('min-w-0', props.className)}
        role='img'
        aria-label={t('7-day stability timeline for {{model}}', {
          model: props.modelName,
        })}
      >
        <div className='grid min-w-0 flex-1 grid-cols-[repeat(14,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(28,minmax(0,1fr))]'>
          {props.timeline.map((bucket) => {
            const rate = bucket.sample_count > 0 ? bucket.success_rate : null
            return (
              <Tooltip key={bucket.started_at}>
                <TooltipTrigger
                  render={
                    <span
                      className={cn(
                        'bg-muted h-5 min-w-0 rounded-[5px] transition-transform duration-150 hover:z-10 hover:scale-y-125 hover:scale-x-110 sm:h-6',
                        bucketClass(bucket.status)
                      )}
                      aria-label={`${bucketLabel(bucket.status, t)}${rate === null ? '' : `, ${rate.toFixed(1)}%`}`}
                    />
                  }
                />
                <TooltipContent className='font-mono text-xs'>
                  <div>{formatBucketStartedAt(bucket.started_at)}</div>
                  <div className='font-sans font-medium'>
                    {bucketLabel(bucket.status, t)}
                  </div>
                  <div>
                    {rate === null
                      ? t('No probe data')
                      : t('{{rate}}% success', { rate: rate.toFixed(1) })}
                  </div>
                  <div>
                    {t('{{count}} probes', { count: bucket.sample_count })}
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </div>
    </TooltipProvider>
  )
}
