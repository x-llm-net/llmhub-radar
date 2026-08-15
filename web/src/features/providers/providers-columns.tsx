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
import type { ColumnDef } from '@tanstack/react-table'
import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { LongText } from '@/components/long-text'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { formatTimestamp } from '@/lib/format'

import { ProviderRowActions } from './provider-row-actions'
import type { HubProviderAdminItem } from './types'

const providerStatusDisplay = {
  pending: { label: 'Pending review', variant: 'warning' },
  active: { label: 'Active', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'danger' },
  disabled: { label: 'Disabled', variant: 'neutral' },
} as const

export function useProvidersColumns(): ColumnDef<HubProviderAdminItem>[] {
  const { t } = useTranslation()
  return [
    {
      accessorKey: 'id',
      header: t('ID'),
      cell: ({ row }) => <TableId value={row.original.id} />,
      size: 72,
      meta: { mobileOrder: 10 },
    },
    {
      accessorKey: 'name',
      header: t('Channel Provider'),
      cell: ({ row }) => {
        const provider = row.original
        return (
          <div className='flex min-w-[200px] items-center gap-3'>
            <Avatar className='size-9 rounded-md'>
              <AvatarImage src={provider.logo_url || undefined} alt='' />
              <AvatarFallback className='rounded-md text-xs'>
                {provider.name.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className='min-w-0'>
              <LongText className='max-w-[220px] font-medium'>
                <Link
                  to='/channels'
                  search={{ ownership: [`provider:${provider.id}`] }}
                  className='hover:text-primary hover:underline'
                >
                  {provider.name}
                </Link>
              </LongText>
              {provider.website && (
                <a
                  href={provider.website}
                  target='_blank'
                  rel='noreferrer'
                  className='text-muted-foreground hover:text-foreground mt-0.5 flex max-w-[240px] items-center gap-1 text-xs'
                >
                  <LongText>{provider.website}</LongText>
                  <ExternalLink
                    className='size-3 shrink-0'
                    aria-hidden='true'
                  />
                </a>
              )}
            </div>
          </div>
        )
      },
      enableSorting: false,
      size: 300,
      meta: { mobileTitle: true },
    },
    {
      id: 'owner',
      header: t('Owner'),
      cell: ({ row }) => (
        <Button
          variant='link'
          className='h-auto min-w-[150px] justify-start p-0 text-left'
          render={
            <Link
              to='/users'
              search={{ filter: row.original.owner_username }}
            />
          }
        >
          <span className='flex min-w-0 flex-col items-start'>
            <LongText className='max-w-[180px] font-medium'>
              {(row.original.owner_display_name ||
                row.original.owner_username) === 'Root User'
                ? t('Root User')
                : row.original.owner_display_name ||
                  row.original.owner_username}
            </LongText>
            <LongText className='text-muted-foreground max-w-[180px] text-xs'>
              @{row.original.owner_username}
            </LongText>
          </span>
        </Button>
      ),
      enableSorting: false,
      size: 210,
      meta: { mobileOrder: 20 },
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      cell: ({ row }) => {
        const display = providerStatusDisplay[row.original.status]
        return (
          <StatusBadge
            label={t(display.label)}
            variant={display.variant}
            copyable={false}
          />
        )
      },
      enableSorting: false,
      size: 120,
      meta: { mobileBadge: true },
    },
    {
      id: 'channels',
      header: t('Supply Channels'),
      cell: ({ row }) => (
        <div className='flex min-w-[150px] flex-wrap gap-1'>
          <StatusBadge
            label={t('{{count}} total', {
              count: row.original.channel_count,
            })}
            variant='neutral'
            copyable={false}
            showDot={false}
          />
          <StatusBadge
            label={t('{{count}} online', {
              count: row.original.online_channel_count,
            })}
            variant={
              row.original.online_channel_count > 0 ? 'success' : 'neutral'
            }
            copyable={false}
            showDot={false}
          />
        </div>
      ),
      enableSorting: false,
      size: 210,
      meta: { mobileOrder: 30 },
    },
    {
      id: 'model_health',
      header: t('Model health'),
      cell: ({ row }) => (
        <div className='flex min-w-[150px] flex-wrap gap-1'>
          <StatusBadge
            label={t('{{count}} available', {
              count: row.original.available_model_count,
            })}
            variant='success'
            copyable={false}
            showDot={false}
          />
          {row.original.error_model_count > 0 && (
            <StatusBadge
              label={t('{{count}} abnormal', {
                count: row.original.error_model_count,
              })}
              variant='danger'
              copyable={false}
              showDot={false}
            />
          )}
        </div>
      ),
      enableSorting: false,
      size: 210,
      meta: { mobileOrder: 40 },
    },
    {
      id: 'upstream_usage',
      header: t('Upstream reuse'),
      cell: ({ row }) => {
        const usages = row.original.upstream_usages || []
        if (usages.length === 0) {
          return <span className='text-muted-foreground'>-</span>
        }
        return (
          <div className='min-w-[240px] space-y-1.5'>
            {usages.slice(0, 2).map((usage) => (
              <div key={usage.origin}>
                <LongText className='max-w-[260px] text-xs font-medium'>
                  {usage.origin}
                </LongText>
                <p className='text-muted-foreground text-xs'>
                  {t('{{providerCount}} providers, {{channelCount}} channels', {
                    providerCount: usage.provider_count,
                    channelCount: usage.channel_count,
                  })}
                </p>
              </div>
            ))}
            {usages.length > 2 && (
              <p className='text-muted-foreground text-xs'>
                {t('{{count}} more upstreams', { count: usages.length - 2 })}
              </p>
            )}
          </div>
        )
      },
      enableSorting: false,
      size: 300,
      meta: { mobileOrder: 45 },
    },
    {
      accessorKey: 'last_probe_at',
      header: t('Last probe'),
      cell: ({ row }) => (
        <span className='text-muted-foreground text-sm'>
          {row.original.last_probe_at
            ? formatTimestamp(row.original.last_probe_at)
            : '-'}
        </span>
      ),
      enableSorting: false,
      size: 180,
      meta: { mobileHidden: true },
    },
    {
      accessorKey: 'created_at',
      header: t('Created At'),
      cell: ({ row }) => (
        <span className='text-muted-foreground text-sm'>
          {formatTimestamp(row.original.created_at)}
        </span>
      ),
      enableSorting: false,
      size: 180,
      meta: { mobileHidden: true },
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: ({ row }) => <ProviderRowActions provider={row.original} />,
      enableSorting: false,
      enableHiding: false,
      size: 120,
      meta: { pinned: 'right' as const },
    },
  ]
}
