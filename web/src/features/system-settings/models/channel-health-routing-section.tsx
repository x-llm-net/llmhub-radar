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
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  CHANNEL_STATUS_CONFIG,
  CHANNEL_STATUS,
} from '@/features/channels/constants'
import { getChannelTypeLabel } from '@/features/channels/lib/channel-utils'
import { getAdminProviders } from '@/features/providers/api'
import { formatTimestamp } from '@/lib/format'

import { SettingsSection } from '../components/settings-section'
import {
  getHubRoutingHealth,
  hubRoutingHealthQueryKey,
  type HubRoutingHealthParams,
  type HubRoutingHealthRow,
} from './channel-health-routing-api'

const PAGE_SIZE = 30

const TIER_LABELS: Record<string, string> = {
  special: 'Special price',
  low: 'Economy',
  medium: 'Standard',
  high: 'High quality',
}

const REASON_LABELS: Record<string, string> = {
  provider_disabled: 'Provider disabled',
  channel_manually_disabled: 'Channel manually disabled',
  channel_auto_disabled: 'Channel automatically disabled',
  channel_disabled: 'Channel disabled',
  supply_unavailable: 'Supply unavailable',
  model_unpublished: 'Model not listed',
  probe_unavailable: 'Probe unavailable',
  probe_unmonitored: 'No Hub probe data',
  no_routable_ability: 'No routable service tier ability',
}

function formatLatency(value: number | null) {
  if (value == null || value <= 0) return '-'
  if (value < 1000) return `${value} ms`
  return `${(value / 1000).toFixed(2)} s`
}

function probeStatusMeta(status: string): {
  label: string
  variant: StatusVariant
} {
  if (status === 'available') return { label: 'Available', variant: 'success' }
  if (status === 'error') return { label: 'Error', variant: 'danger' }
  if (status === 'testing') return { label: 'Testing', variant: 'info' }
  if (status === 'pending' || status === 'waiting') {
    return { label: 'Waiting', variant: 'warning' }
  }
  return { label: 'Unmonitored', variant: 'neutral' }
}

function supplyStatusMeta(status: string): {
  label: string
  variant: StatusVariant
} {
  if (status === 'available') return { label: 'Available', variant: 'success' }
  if (status === 'partial') {
    return { label: 'Partially available', variant: 'warning' }
  }
  if (status === 'error') return { label: 'Error', variant: 'danger' }
  if (status === 'testing') return { label: 'Testing', variant: 'info' }
  return { label: 'Pending', variant: 'neutral' }
}

function endpointLabel(endpoint: string) {
  if (endpoint === 'openai-response') return 'Responses endpoint'
  if (endpoint === 'image-generation') return 'Image endpoint'
  if (endpoint === 'anthropic') return 'Anthropic endpoint'
  return 'Chat endpoint'
}

function TierList({ tiers, active }: { tiers: string[]; active?: boolean }) {
  const { t } = useTranslation()
  if (tiers.length === 0) {
    return <span className='text-muted-foreground text-xs'>-</span>
  }
  return (
    <div className='flex flex-wrap gap-1'>
      {tiers.map((tier) => (
        <StatusBadge
          key={tier}
          label={t(TIER_LABELS[tier] ?? tier)}
          variant={active ? 'success' : 'neutral'}
          copyable={false}
        />
      ))}
    </div>
  )
}

function RoutingHealthRow({ row }: { row: HubRoutingHealthRow }) {
  const { t } = useTranslation()
  const channelStatus =
    CHANNEL_STATUS_CONFIG[
      row.channel_status as keyof typeof CHANNEL_STATUS_CONFIG
    ] ?? CHANNEL_STATUS_CONFIG[CHANNEL_STATUS.UNKNOWN]
  const probeStatus = probeStatusMeta(row.probe_status)
  const supplyStatus = supplyStatusMeta(row.supply_status)
  const endpoint = row.resolved_endpoint_type || row.endpoint_type
  return (
    <TableRow>
      <TableCell className='min-w-56 align-top'>
        <div className='space-y-1'>
          <div className='font-medium'>{row.channel_name}</div>
          <div className='text-muted-foreground text-xs'>
            {row.provider_id > 0 ? row.provider_name : t('Platform-owned')} · #
            {row.channel_id}
          </div>
          <div className='text-muted-foreground text-xs'>
            {t(getChannelTypeLabel(row.channel_type))}
          </div>
        </div>
      </TableCell>
      <TableCell className='min-w-64 align-top'>
        <div className='space-y-1'>
          <div className='font-mono text-xs font-medium'>{row.model_name}</div>
          <div className='text-muted-foreground text-xs'>
            {t(endpointLabel(endpoint))} ·{' '}
            {t(row.probe_kind === 'image' ? 'Image' : 'Text')}
          </div>
          <div className='text-muted-foreground text-xs'>
            {t('Family')}: {row.model_family}
          </div>
        </div>
      </TableCell>
      <TableCell className='min-w-52 align-top'>
        <div className='flex flex-wrap gap-1'>
          <StatusBadge
            label={t(channelStatus.label)}
            variant={channelStatus.variant}
            copyable={false}
          />
          {row.supply_group_id > 0 && (
            <StatusBadge
              label={t(supplyStatus.label)}
              variant={supplyStatus.variant}
              copyable={false}
            />
          )}
          <StatusBadge
            label={t(probeStatus.label)}
            variant={probeStatus.variant}
            copyable={false}
          />
          {row.supply_group_id > 0 && (
            <StatusBadge
              label={t(row.published ? 'Listed' : 'Not listed')}
              variant={row.published ? 'info' : 'neutral'}
              copyable={false}
            />
          )}
        </div>
        {row.channel_status_reason && (
          <p
            className='text-muted-foreground mt-1 max-w-56 truncate text-xs'
            title={row.channel_status_reason}
          >
            {row.channel_status_reason}
          </p>
        )}
      </TableCell>
      <TableCell className='min-w-64 align-top'>
        <div className='grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1'>
          <span className='text-muted-foreground text-xs'>{t('Eligible')}</span>
          <TierList tiers={row.eligible_service_tiers} />
          <span className='text-muted-foreground text-xs'>{t('Routable')}</span>
          <TierList tiers={row.routable_service_tiers} active />
        </div>
        {row.price_multiplier != null && (
          <div className='text-muted-foreground mt-1 text-xs tabular-nums'>
            {t('Supply multiplier')}: {row.price_multiplier}x
          </div>
        )}
      </TableCell>
      <TableCell className='min-w-52 align-top tabular-nums'>
        <div className='text-xs'>{formatTimestamp(row.last_probe_at)}</div>
        <div className='text-muted-foreground mt-1 text-xs'>
          {t('Latency')} {formatLatency(row.last_latency_ms)} · {t('TTFT')}{' '}
          {formatLatency(row.last_first_token_ms)}
        </div>
      </TableCell>
      <TableCell className='min-w-60 align-top tabular-nums'>
        <div className='text-xs'>
          {row.success_rate_7d == null
            ? '-'
            : `${row.success_rate_7d.toFixed(1)}%`}{' '}
          <span className='text-muted-foreground'>
            · {row.sample_count_7d} {t('samples')}
          </span>
        </div>
        <div className='text-muted-foreground mt-1 text-xs'>
          {t('Latency P50/P95')}: {formatLatency(row.latency_p50_ms)} /{' '}
          {formatLatency(row.latency_p95_ms)}
        </div>
        <div className='text-muted-foreground text-xs'>
          {t('TTFT P50/P95')}: {formatLatency(row.first_token_p50_ms)} /{' '}
          {formatLatency(row.first_token_p95_ms)}
        </div>
      </TableCell>
      <TableCell className='min-w-36 align-top tabular-nums'>
        <div className='text-xs font-medium'>
          {row.ranking_score_bps == null
            ? '-'
            : (row.ranking_score_bps / 100).toFixed(1)}
        </div>
        <div className='text-muted-foreground mt-1 text-xs'>
          {t('Confidence')}:{' '}
          {row.confidence_bps == null
            ? '-'
            : `${(row.confidence_bps / 100).toFixed(1)}%`}
        </div>
      </TableCell>
      <TableCell className='min-w-64 align-top'>
        {row.skip_reason_codes.length > 0 ? (
          <div className='flex flex-wrap gap-1'>
            {row.skip_reason_codes.map((reason) => (
              <StatusBadge
                key={reason}
                label={t(REASON_LABELS[reason] ?? reason)}
                variant={reason === 'probe_unmonitored' ? 'neutral' : 'warning'}
                copyable={false}
              />
            ))}
          </div>
        ) : (
          <StatusBadge
            label={t('No routing limits')}
            variant='success'
            copyable={false}
          />
        )}
        {(row.last_error_code || row.last_error) && (
          <p
            className='text-destructive mt-1 max-w-64 truncate text-xs'
            title={`${row.last_error_code} ${row.last_error}`.trim()}
          >
            {[row.last_error_code, row.last_error].filter(Boolean).join(': ')}
          </p>
        )}
      </TableCell>
    </TableRow>
  )
}

export function ChannelHealthRoutingSection() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [providerID, setProviderID] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [channelStatus, setChannelStatus] = useState('')
  const [probeStatus, setProbeStatus] = useState('')
  const [serviceTier, setServiceTier] = useState('')
  const params: HubRoutingHealthParams = {
    keyword: keyword || undefined,
    provider_id: providerID || undefined,
    endpoint: endpoint || undefined,
    channel_status: channelStatus ? Number(channelStatus) : undefined,
    probe_status: probeStatus || undefined,
    service_tier: serviceTier || undefined,
    p: page,
    page_size: PAGE_SIZE,
  }
  const health = useQuery({
    queryKey: [...hubRoutingHealthQueryKey, params],
    queryFn: () => getHubRoutingHealth(params),
    placeholderData: (previous) => previous,
  })
  const providers = useQuery({
    queryKey: ['hub-admin', 'providers', 'routing-health-filter'],
    queryFn: () => getAdminProviders({ p: 1, page_size: 100 }),
  })
  const items = health.data?.data?.items ?? []
  const total = health.data?.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const updateFilter = (setter: (value: string) => void, value: string) => {
    setter(value)
    setPage(1)
  }
  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    updateFilter(setKeyword, searchInput.trim())
  }

  return (
    <SettingsSection title={t('Channel Health & Routing')}>
      <form
        className='flex flex-wrap items-center gap-2'
        onSubmit={submitSearch}
      >
        <div className='flex min-w-64 flex-1 items-center gap-1'>
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('Search provider, channel, or model')}
            aria-label={t('Search provider, channel, or model')}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type='submit'
                  variant='outline'
                  size='icon'
                  aria-label={t('Search')}
                />
              }
            >
              <Search />
            </TooltipTrigger>
            <TooltipContent>{t('Search')}</TooltipContent>
          </Tooltip>
        </div>
        <NativeSelect
          value={providerID}
          onChange={(event) => updateFilter(setProviderID, event.target.value)}
          aria-label={t('Channel Provider')}
        >
          <NativeSelectOption value=''>{t('All providers')}</NativeSelectOption>
          <NativeSelectOption value='platform'>
            {t('Platform-owned')}
          </NativeSelectOption>
          {(providers.data?.data?.items ?? []).map((provider) => (
            <NativeSelectOption key={provider.id} value={String(provider.id)}>
              {provider.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          value={endpoint}
          onChange={(event) => updateFilter(setEndpoint, event.target.value)}
          aria-label={t('Endpoint')}
        >
          <NativeSelectOption value=''>{t('All endpoints')}</NativeSelectOption>
          <NativeSelectOption value='openai'>
            {t('Chat endpoint')}
          </NativeSelectOption>
          <NativeSelectOption value='openai-response'>
            {t('Responses endpoint')}
          </NativeSelectOption>
          <NativeSelectOption value='anthropic'>
            {t('Anthropic endpoint')}
          </NativeSelectOption>
          <NativeSelectOption value='image-generation'>
            {t('Image endpoint')}
          </NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          value={channelStatus}
          onChange={(event) =>
            updateFilter(setChannelStatus, event.target.value)
          }
          aria-label={t('Channel status')}
        >
          <NativeSelectOption value=''>
            {t('All channel statuses')}
          </NativeSelectOption>
          <NativeSelectOption value='1'>{t('Enabled')}</NativeSelectOption>
          <NativeSelectOption value='2'>{t('Disabled')}</NativeSelectOption>
          <NativeSelectOption value='3'>
            {t('Auto Disabled')}
          </NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          value={probeStatus}
          onChange={(event) => updateFilter(setProbeStatus, event.target.value)}
          aria-label={t('Probe status')}
        >
          <NativeSelectOption value=''>
            {t('All probe statuses')}
          </NativeSelectOption>
          <NativeSelectOption value='available'>
            {t('Available')}
          </NativeSelectOption>
          <NativeSelectOption value='error'>{t('Error')}</NativeSelectOption>
          <NativeSelectOption value='testing'>
            {t('Testing')}
          </NativeSelectOption>
          <NativeSelectOption value='waiting'>
            {t('Waiting')}
          </NativeSelectOption>
          <NativeSelectOption value='pending'>
            {t('Pending')}
          </NativeSelectOption>
          <NativeSelectOption value='unmonitored'>
            {t('Unmonitored')}
          </NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          value={serviceTier}
          onChange={(event) => updateFilter(setServiceTier, event.target.value)}
          aria-label={t('Service tier')}
        >
          <NativeSelectOption value=''>
            {t('All service tiers')}
          </NativeSelectOption>
          {Object.entries(TIER_LABELS).map(([tier, label]) => (
            <NativeSelectOption key={tier} value={tier}>
              {t(label)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type='button'
                variant='outline'
                size='icon'
                onClick={() => health.refetch()}
                disabled={health.isFetching}
                aria-label={t('Refresh')}
              />
            }
          >
            {health.isFetching ? (
              <Loader2 className='animate-spin' />
            ) : (
              <RefreshCw />
            )}
          </TooltipTrigger>
          <TooltipContent>{t('Refresh')}</TooltipContent>
        </Tooltip>
      </form>

      <div className='overflow-hidden rounded-md border'>
        <div className='overflow-x-auto'>
          <Table className='min-w-[1720px]'>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Channel')}</TableHead>
                <TableHead>{t('Model / Endpoint')}</TableHead>
                <TableHead>{t('Current state')}</TableHead>
                <TableHead>{t('Service tiers')}</TableHead>
                <TableHead>{t('Latest probe')}</TableHead>
                <TableHead>{t('7-day probe metrics')}</TableHead>
                <TableHead>{t('Ranking score')}</TableHead>
                <TableHead>{t('Routing limits')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className='h-40 text-center'>
                    <Loader2 className='mx-auto animate-spin' />
                  </TableCell>
                </TableRow>
              )}
              {health.isError && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className='text-destructive h-40 text-center'
                  >
                    {t('Failed to load channel health data')}
                  </TableCell>
                </TableRow>
              )}
              {!health.isLoading && !health.isError && items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className='text-muted-foreground h-40 text-center'
                  >
                    {t('No channel health records found')}
                  </TableCell>
                </TableRow>
              )}
              {!health.isLoading &&
                !health.isError &&
                items.map((row) => (
                  <RoutingHealthRow
                    key={`${row.channel_id}-${row.model_name}-${row.endpoint_type}-${row.probe_kind}`}
                    row={row}
                  />
                ))}
            </TableBody>
          </Table>
        </div>
        <div className='flex items-center justify-between gap-3 border-t px-3 py-2'>
          <span className='text-muted-foreground text-xs'>
            {t('{{count}} records', { count: total })}
          </span>
          <div className='flex items-center gap-2'>
            <span className='text-muted-foreground text-xs'>
              {t('Page {{page}} of {{total}}', { page, total: pageCount })}
            </span>
            <Button
              variant='outline'
              size='icon-sm'
              onClick={() => setPage((current) => current - 1)}
              disabled={page <= 1}
              aria-label={t('Previous page')}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant='outline'
              size='icon-sm'
              onClick={() => setPage((current) => current + 1)}
              disabled={page >= pageCount}
              aria-label={t('Next page')}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
    </SettingsSection>
  )
}
