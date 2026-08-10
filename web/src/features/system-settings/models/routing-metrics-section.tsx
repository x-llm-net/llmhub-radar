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
import { Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { SettingsSection } from '../components/settings-section'
import {
  getHubRoutingMetrics,
  hubRoutingMetricsQueryKey,
  type HubRoutingMetric,
} from './routing-metrics-api'

function formatLatency(value: number | undefined) {
  if (value == null || value <= 0) return '-'
  if (value < 1000) return `${value} ms`
  return `${(value / 1000).toFixed(2)} s`
}

function endpointLabel(endpoint: string) {
  if (endpoint === 'openai-response') return 'Responses endpoint'
  if (endpoint === 'image-generation') return 'Image endpoint'
  if (endpoint === 'anthropic') return 'Anthropic endpoint'
  return 'Chat endpoint'
}

function RoutingMetricRow({ metric }: { metric: HubRoutingMetric }) {
  const { t } = useTranslation()
  return (
    <TableRow>
      <TableCell className='min-w-56 align-top'>
        <div className='font-mono text-xs font-medium'>{metric.model_name}</div>
        <div className='text-muted-foreground mt-1 text-xs'>
          {t(endpointLabel(metric.endpoint_type))}
        </div>
      </TableCell>
      <TableCell className='min-w-44 align-top'>
        <div className='text-xs'>
          {t('Provider')} #{metric.provider_id}
        </div>
        <div className='text-muted-foreground mt-1 text-xs'>
          {t('Channel')} #{metric.channel_id}
        </div>
      </TableCell>
      <TableCell className='min-w-28 align-top tabular-nums'>
        {metric.request_count}
      </TableCell>
      <TableCell className='min-w-32 align-top tabular-nums'>
        <div>{metric.success_rate.toFixed(1)}%</div>
        <div className='text-muted-foreground mt-1 text-xs'>
          {metric.success_count} {t('successful attempts')}
        </div>
      </TableCell>
      <TableCell className='min-w-36 align-top tabular-nums'>
        {formatLatency(metric.avg_latency_ms)}
      </TableCell>
      <TableCell className='min-w-36 align-top tabular-nums'>
        {formatLatency(metric.avg_first_token_ms)}
      </TableCell>
    </TableRow>
  )
}

export function RoutingMetricsSection() {
  const { t } = useTranslation()
  const metrics = useQuery({
    queryKey: hubRoutingMetricsQueryKey,
    queryFn: () => getHubRoutingMetrics({ hours: 24, limit: 100 }),
  })
  const items = metrics.data?.data?.items ?? []

  return (
    <SettingsSection title={t('Real Request Metrics')}>
      <div className='flex items-center justify-between gap-3'>
        <p className='text-muted-foreground text-sm'>
          {t('Last 24 hours; failed retries are counted as attempts.')}
        </p>
        <Button
          type='button'
          variant='outline'
          size='icon'
          onClick={() => metrics.refetch()}
          disabled={metrics.isFetching}
          aria-label={t('Refresh')}
        >
          {metrics.isFetching ? (
            <Loader2 className='animate-spin' />
          ) : (
            <RefreshCw />
          )}
        </Button>
      </div>
      <div className='mt-3 overflow-hidden rounded-md border'>
        <div className='overflow-x-auto'>
          <Table className='min-w-[900px]'>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Model / Endpoint')}</TableHead>
                <TableHead>{t('Provider / Channel')}</TableHead>
                <TableHead>{t('Attempts')}</TableHead>
                <TableHead>{t('Success rate')}</TableHead>
                <TableHead>{t('Average latency')}</TableHead>
                <TableHead>{t('Average TTFT')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className='h-32 text-center'>
                    <Loader2 className='mx-auto animate-spin' />
                  </TableCell>
                </TableRow>
              )}
              {metrics.isError && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className='text-destructive h-32 text-center'
                  >
                    {t('Failed to load real request metrics')}
                  </TableCell>
                </TableRow>
              )}
              {!metrics.isLoading && !metrics.isError && items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className='text-muted-foreground h-32 text-center'
                  >
                    {t('No real request metrics found')}
                  </TableCell>
                </TableRow>
              )}
              {!metrics.isLoading &&
                !metrics.isError &&
                items.map((metric) => (
                  <RoutingMetricRow
                    key={`${metric.model_name}-${metric.endpoint_type}-${metric.provider_id}-${metric.channel_id}`}
                    metric={metric}
                  />
                ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </SettingsSection>
  )
}
