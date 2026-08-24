/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowUpRight,
  CircleDollarSign,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getChannelTypeLabel } from '@/features/channels/lib'
import { formatQuota, formatTimestamp } from '@/lib/format'
import { getProviderPublicURL } from '@/lib/provider-domain'

import { getSupplyChannelStatus } from '../provider/provider-channels-columns'
import {
  adminProviderChannelsQueryKey,
  adminProviderDetailQueryKey,
  getAdminProvider,
  getAdminProviderChannels,
  getAdminProviderEarningSummary,
} from './api'
import { ProviderLogoAvatar } from './provider-logo-avatar'
import { ProviderSettlementSheet } from './provider-settlement-sheet'
import type { HubProviderAdminItem } from './types'

const CHANNEL_PAGE_SIZE = 20

const providerStatusDisplay = {
  pending: { label: 'Pending review', variant: 'warning' },
  active: { label: 'Active', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'danger' },
  disabled: { label: 'Disabled', variant: 'neutral' },
} as const

export function ProviderDetail({ providerId }: { providerId: number }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [settlementOpen, setSettlementOpen] = useState(false)
  const validProviderId = Number.isInteger(providerId) && providerId > 0
  const providerQuery = useQuery({
    queryKey: adminProviderDetailQueryKey(providerId),
    queryFn: () => getAdminProvider(providerId),
    enabled: validProviderId,
  })
  const channelsQuery = useQuery({
    queryKey: [...adminProviderChannelsQueryKey(providerId), page],
    queryFn: () =>
      getAdminProviderChannels(providerId, {
        p: page,
        page_size: CHANNEL_PAGE_SIZE,
        sort_by: 'updated_at',
        sort_order: 'desc',
      }),
    enabled: validProviderId,
    placeholderData: (previousData) => previousData,
  })
  const earningsSummaryQuery = useQuery({
    queryKey: [...adminProviderDetailQueryKey(providerId), 'earnings'],
    queryFn: () => getAdminProviderEarningSummary(providerId),
    enabled: validProviderId,
  })

  if (!validProviderId || providerQuery.isError) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Provider details')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <ErrorState
            title={t('Failed to load provider')}
            onRetry={
              providerQuery.isError
                ? () => void providerQuery.refetch()
                : undefined
            }
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  const provider = providerQuery.data?.data
  if (providerQuery.isLoading || !provider) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Provider details')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='flex h-32 items-center justify-center'>
            <Loader2 className='animate-spin' />
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  const status = providerStatusDisplay[provider.status]
  const channelData = channelsQuery.data?.data
  const channels = channelData?.items ?? []
  const totalPages = Math.max(
    1,
    Math.ceil((channelData?.total ?? 0) / CHANNEL_PAGE_SIZE)
  )
  const summary = earningsSummaryQuery.data?.data
  const summaryItems = [
    [t('Total provider earnings'), summary?.settled_income_quota ?? 0],
    [t('Pending settlement'), summary?.reserved_withdrawal_quota ?? 0],
    [t('Available to withdraw'), summary?.withdrawable_quota ?? 0],
    [t('Total withdrawn'), summary?.paid_withdrawal_quota ?? 0],
  ] as const

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Breadcrumb>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          render={<Link to='/providers' />}
        >
          <ArrowLeft />
          {t('Providers')}
        </Button>
      </SectionPageLayout.Breadcrumb>
      <SectionPageLayout.Title>{provider.name}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <StatusBadge
          label={t(status.label)}
          variant={status.variant}
          copyable={false}
        />
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => setSettlementOpen(true)}
        >
          <CircleDollarSign />
          {t('Provider earnings')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='h-full min-h-0 space-y-4 overflow-y-auto pb-2'>
          <ProviderProfileCard provider={provider} />

          <section className='space-y-3'>
            <div className='flex items-center justify-between gap-3'>
              <div>
                <h2 className='text-base font-semibold'>
                  {t('Provider earnings')}
                </h2>
                <p className='text-muted-foreground text-sm'>
                  {t('Platform fee')}:{' '}
                  {(summary?.platform_fee_basis_points ??
                    provider.effective_platform_fee_basis_points) / 100}
                  %
                </p>
              </div>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => void earningsSummaryQuery.refetch()}
                disabled={earningsSummaryQuery.isFetching}
              >
                <RefreshCw
                  className={
                    earningsSummaryQuery.isFetching ? 'animate-spin' : undefined
                  }
                />
                {t('Refresh')}
              </Button>
            </div>
            <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
              {summaryItems.map(([label, value]) => (
                <Card key={label} size='sm'>
                  <CardHeader>
                    <CardTitle className='text-muted-foreground text-sm font-normal'>
                      {label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className='text-xl font-semibold tabular-nums'>
                      {earningsSummaryQuery.isLoading
                        ? '-'
                        : formatQuota(value)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section className='space-y-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div>
                <h2 className='text-base font-semibold'>
                  {t('Supply Channels')}
                </h2>
                <p className='text-muted-foreground text-sm'>
                  {t('{{count}} total', { count: channelData?.total ?? 0 })}
                </p>
              </div>
              <Button
                type='button'
                variant='outline'
                size='sm'
                render={
                  <Link
                    to='/channels'
                    search={{ ownership: [`provider:${provider.id}`] }}
                  />
                }
              >
                {t('View all channels')}
                <ArrowUpRight />
              </Button>
            </div>
            <div className='overflow-hidden rounded-lg border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Channel')}</TableHead>
                    <TableHead>{t('Supply status')}</TableHead>
                    <TableHead>{t('Tenant publication')}</TableHead>
                    <TableHead>{t('Models')}</TableHead>
                    <TableHead>{t('Multiplier')}</TableHead>
                    <TableHead>{t('Last probe')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {channelsQuery.isLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className='h-28 text-center'>
                        <Loader2 className='mx-auto animate-spin' />
                      </TableCell>
                    </TableRow>
                  )}
                  {!channelsQuery.isLoading && channels.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className='text-muted-foreground h-28 text-center'
                      >
                        {channelsQuery.isError
                          ? t('Failed to load supply channels')
                          : t('No supply channels yet')}
                      </TableCell>
                    </TableRow>
                  )}
                  {channels.map((item) => {
                    const supplyStatus = getSupplyChannelStatus(
                      item.supply.status
                    )
                    return (
                      <TableRow key={item.channel.id}>
                        <TableCell>
                          <div className='min-w-48 space-y-0.5'>
                            <p className='font-medium'>{item.channel.name}</p>
                            <p className='text-muted-foreground max-w-72 truncate text-xs'>
                              {item.channel.base_url || t('Default Base URL')}
                            </p>
                            <p className='text-muted-foreground text-xs'>
                              {t(getChannelTypeLabel(item.channel.type))}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            label={t(supplyStatus.label)}
                            variant={supplyStatus.variant}
                            copyable={false}
                          />
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            label={
                              item.supply.tenant_published
                                ? t('Published')
                                : t('Unpublished')
                            }
                            variant={
                              item.supply.tenant_published
                                ? 'success'
                                : 'neutral'
                            }
                            copyable={false}
                          />
                        </TableCell>
                        <TableCell className='whitespace-nowrap'>
                          {t('{{count}} listed', {
                            count: item.supply.published_model_count,
                          })}{' '}
                          /{' '}
                          {t('{{count}} online', {
                            count: item.supply.online_model_count,
                          })}
                        </TableCell>
                        <TableCell className='whitespace-nowrap'>
                          × {item.supply.price_multiplier}
                        </TableCell>
                        <TableCell className='text-muted-foreground whitespace-nowrap'>
                          {item.supply.last_probe_at
                            ? formatTimestamp(item.supply.last_probe_at)
                            : '-'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            {channelsQuery.isError && (
              <div className='flex justify-end'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => void channelsQuery.refetch()}
                >
                  <RefreshCw />
                  {t('Retry')}
                </Button>
              </div>
            )}
            {totalPages > 1 && (
              <div className='flex items-center justify-end gap-2'>
                <span className='text-muted-foreground text-xs'>
                  {t('Page {{page}} of {{total}}', { page, total: totalPages })}
                </span>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => setPage((current) => current - 1)}
                  disabled={page <= 1 || channelsQuery.isFetching}
                >
                  {t('Previous page')}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => setPage((current) => current + 1)}
                  disabled={page >= totalPages || channelsQuery.isFetching}
                >
                  {t('Next page')}
                </Button>
              </div>
            )}
          </section>
        </div>
      </SectionPageLayout.Content>
      <ProviderSettlementSheet
        provider={provider}
        open={settlementOpen}
        onOpenChange={setSettlementOpen}
        allowAdjustment={false}
      />
    </SectionPageLayout>
  )
}

function ProviderProfileCard({ provider }: { provider: HubProviderAdminItem }) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardContent className='flex flex-wrap items-start gap-4 pt-6'>
        <ProviderLogoAvatar provider={provider} />
        <div className='min-w-0 flex-1 space-y-1'>
          <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
            <h1 className='text-lg font-semibold'>{provider.name}</h1>
            <span className='text-muted-foreground text-sm'>
              #{provider.id}
            </span>
          </div>
          <p className='text-muted-foreground text-sm'>
            {t('Owner')}:{' '}
            {provider.owner_display_name || provider.owner_username} (@
            {provider.owner_username})
          </p>
          <p className='text-muted-foreground text-sm'>
            {t('Reseller')}: {provider.tenant_name || t('Platform public pool')}
          </p>
          {provider.website && (
            <a
              href={provider.website}
              target='_blank'
              rel='noreferrer'
              className='text-primary flex max-w-full items-center gap-1 text-sm hover:underline'
            >
              <span className='truncate'>{provider.website}</span>
              <ExternalLink className='size-3 shrink-0' />
            </a>
          )}
          {provider.slug && (
            <a
              href={getProviderPublicURL(provider.slug)}
              target='_blank'
              rel='noreferrer'
              className='text-primary flex max-w-full items-center gap-1 text-sm hover:underline'
            >
              <span className='truncate'>
                {getProviderPublicURL(provider.slug)}
              </span>
              <ExternalLink className='size-3 shrink-0' />
            </a>
          )}
        </div>
        <div className='text-muted-foreground space-y-1 text-sm sm:min-w-48 sm:text-right'>
          <p>
            {t('Review contact')}: {provider.contact_value || '-'}
          </p>
          {provider.support_value && (
            <p>
              {t('Public support entry')}: {provider.support_value}
            </p>
          )}
          <p>
            {t('Created At')}: {formatTimestamp(provider.created_at)}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
