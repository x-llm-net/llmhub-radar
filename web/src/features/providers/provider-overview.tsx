import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
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
import { useMediaQuery } from '@/hooks'
import { formatTimestamp } from '@/lib/format'
import { getProviderPublicURL } from '@/lib/provider-domain'

import { getHubAdminTenants, tenantAdminQueryKey } from '../tenant-admin/api'
import { getAdminProviderOverview } from './api'
import { ProviderLogoAvatar } from './provider-logo-avatar'
import type { HubProviderAdminItem } from './types'

const PAGE_SIZE = 20

const statusDisplay = {
  pending: { label: 'Pending review', variant: 'warning' },
  active: { label: 'Active', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'danger' },
  disabled: { label: 'Disabled', variant: 'neutral' },
} as const

export function ProviderOverview() {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('all')
  const [tenantID, setTenantID] = useState('all')
  const [page, setPage] = useState(1)
  const tenantsQuery = useQuery({
    queryKey: tenantAdminQueryKey,
    queryFn: getHubAdminTenants,
  })
  const providersQuery = useQuery({
    queryKey: [
      'hub-admin',
      'provider-overview',
      keyword,
      status,
      tenantID,
      page,
    ],
    queryFn: () =>
      getAdminProviderOverview({
        keyword: keyword || undefined,
        status: status === 'all' ? undefined : status,
        tenant_id: tenantID,
        p: page,
        page_size: PAGE_SIZE,
      }),
  })
  const data = providersQuery.data?.data
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const tenantOptions = tenantsQuery.data?.data?.items ?? []
  const resetPage = () => setPage(1)

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        {t('Provider Overview')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex min-h-0 flex-1 flex-col gap-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value)
                resetPage()
              }}
              placeholder={t('Filter by provider, owner or website...')}
              className='max-w-sm'
            />
            <NativeSelect
              value={tenantID}
              onChange={(event) => {
                setTenantID(event.target.value)
                resetPage()
              }}
              aria-label={t('Reseller')}
            >
              <NativeSelectOption value='all'>
                {t('All tenants')}
              </NativeSelectOption>
              <NativeSelectOption value='platform'>
                {t('Platform public pool')}
              </NativeSelectOption>
              {tenantOptions.map((tenant) => (
                <NativeSelectOption key={tenant.id} value={String(tenant.id)}>
                  {tenant.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              value={status}
              onChange={(event) => {
                setStatus(event.target.value)
                resetPage()
              }}
              aria-label={t('Status')}
            >
              <NativeSelectOption value='all'>
                {t('All Status')}
              </NativeSelectOption>
              {Object.entries(statusDisplay).map(([value, display]) => (
                <NativeSelectOption key={value} value={value}>
                  {t(display.label)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <div className='min-h-0 flex-1 overflow-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('ID')}</TableHead>
                  <TableHead>{t('Channel Provider')}</TableHead>
                  <TableHead>{t('Reseller')}</TableHead>
                  <TableHead>{t('Owner')}</TableHead>
                  <TableHead>{t('Status')}</TableHead>
                  <TableHead>{t('Supply Channels')}</TableHead>
                  <TableHead>{t('Model health')}</TableHead>
                  <TableHead className={isMobile ? 'hidden' : undefined}>
                    {t('Created At')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providersQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className='h-32 text-center'>
                      <Loader2 className='mx-auto animate-spin' />
                    </TableCell>
                  </TableRow>
                )}
                {!providersQuery.isLoading && items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className='text-muted-foreground h-32 text-center'
                    >
                      {t('No providers found')}
                    </TableCell>
                  </TableRow>
                )}
                {!providersQuery.isLoading &&
                  items.map((provider) => (
                    <ProviderOverviewRow
                      key={provider.id}
                      provider={provider}
                      isMobile={isMobile}
                      t={t}
                    />
                  ))}
              </TableBody>
            </Table>
          </div>

          <div className='flex items-center justify-end gap-2'>
            <span className='text-muted-foreground text-xs'>
              {t('Page {{page}} of {{total}}', { page, total: pageCount })}
            </span>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setPage((current) => current - 1)}
              disabled={page <= 1 || providersQuery.isFetching}
            >
              {t('Previous page')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setPage((current) => current + 1)}
              disabled={page >= pageCount || providersQuery.isFetching}
            >
              {t('Next page')}
            </Button>
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function ProviderOverviewRow({
  provider,
  isMobile,
  t,
}: {
  provider: HubProviderAdminItem
  isMobile: boolean
  t: ReturnType<typeof useTranslation>['t']
}) {
  const display = statusDisplay[provider.status]
  return (
    <TableRow>
      <TableCell>
        <TableId value={provider.id} />
      </TableCell>
      <TableCell>
        <div className='flex min-w-[180px] items-center gap-3'>
          <ProviderLogoAvatar provider={provider} />
          <div className='min-w-0'>
            <p className='font-medium'>{provider.name}</p>
            {provider.website && (
              <a
                href={provider.website}
                target='_blank'
                rel='noreferrer'
                className='text-muted-foreground flex max-w-[240px] items-center gap-1 truncate text-xs hover:underline'
              >
                <span className='truncate'>{provider.website}</span>
                <ExternalLink className='size-3 shrink-0' aria-hidden='true' />
              </a>
            )}
            {provider.slug && (
              <a
                href={getProviderPublicURL(provider.slug)}
                target='_blank'
                rel='noreferrer'
                title={t('Public homepage')}
                aria-label={`${t('Public homepage')}: ${getProviderPublicURL(provider.slug)}`}
                className='text-primary hover:text-primary/80 flex max-w-[240px] items-center gap-1 truncate text-xs'
              >
                <span className='truncate'>
                  {getProviderPublicURL(provider.slug)}
                </span>
                <ExternalLink className='size-3 shrink-0' aria-hidden='true' />
              </a>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className='min-w-36'>
        {provider.tenant_name || t('Platform public pool')}
      </TableCell>
      <TableCell className='min-w-36'>
        <div>
          <p>{provider.owner_display_name || provider.owner_username}</p>
          <p className='text-muted-foreground text-xs'>
            @{provider.owner_username}
          </p>
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge
          label={t(display.label)}
          variant={display.variant}
          copyable={false}
        />
      </TableCell>
      <TableCell className='whitespace-nowrap'>
        {t('{{count}} total', { count: provider.channel_count })} /{' '}
        {t('{{count}} online', { count: provider.online_channel_count })}
      </TableCell>
      <TableCell className='whitespace-nowrap'>
        {t('{{count}} available', { count: provider.available_model_count })}
        {provider.error_model_count > 0 &&
          ` / ${t('{{count}} abnormal', { count: provider.error_model_count })}`}
      </TableCell>
      <TableCell className={isMobile ? 'hidden' : undefined}>
        {formatTimestamp(provider.created_at)}
      </TableCell>
    </TableRow>
  )
}
