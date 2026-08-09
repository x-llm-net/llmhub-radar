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
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Settings2, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { BadgeCell } from '@/components/data-table'
import { LongText } from '@/components/long-text'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getChannelTypeLabel } from '@/features/channels/lib'
import { formatTimestamp } from '@/lib/format'

import type { HubProviderChannel } from './types'

export const HUB_SUPPLY_STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'available', label: 'Available' },
  { value: 'partial', label: 'Partially available' },
  { value: 'testing', label: 'Testing' },
  { value: 'pending', label: 'Pending verification' },
  { value: 'error', label: 'Detection failed' },
] as const

export function getSupplyChannelStatus(status: string) {
  switch (status) {
    case 'available':
      return { label: 'Available', variant: 'success' as const }
    case 'partial':
      return { label: 'Partially available', variant: 'warning' as const }
    case 'error':
      return { label: 'Detection failed', variant: 'danger' as const }
    case 'testing':
      return { label: 'Testing', variant: 'info' as const }
    default:
      return { label: 'Pending verification', variant: 'neutral' as const }
  }
}

type ProviderChannelColumnActions = {
  onManageModels: (item: HubProviderChannel) => void
  onEdit: (item: HubProviderChannel) => void
  onDelete: (item: HubProviderChannel) => void
}

export function useProviderChannelsColumns(
  actions: ProviderChannelColumnActions
): ColumnDef<HubProviderChannel>[] {
  const { t } = useTranslation()
  return [
    {
      id: 'id',
      accessorFn: (item) => item.channel.id,
      header: t('ID'),
      cell: ({ row }) => <TableId value={row.original.channel.id} />,
      size: 72,
      meta: { mobileOrder: 10 },
    },
    {
      id: 'name',
      accessorFn: (item) => item.channel.name,
      header: t('Channel'),
      cell: ({ row }) => (
        <div className='flex min-w-[180px] flex-col gap-1'>
          <LongText className='max-w-[240px] font-medium'>
            {row.original.channel.name}
          </LongText>
          <LongText className='text-muted-foreground max-w-[260px] text-xs'>
            {row.original.channel.base_url || t('Default Base URL')}
          </LongText>
        </div>
      ),
      size: 280,
      meta: { mobileTitle: true },
    },
    {
      id: 'type',
      accessorFn: (item) => String(item.channel.type),
      header: t('Type'),
      cell: ({ row }) => (
        <BadgeCell>
          <StatusBadge
            label={t(getChannelTypeLabel(row.original.channel.type))}
            variant='neutral'
            copyable={false}
            showDot={false}
          />
        </BadgeCell>
      ),
      enableSorting: false,
      size: 130,
      meta: { mobileBadge: true },
    },
    {
      id: 'status',
      accessorFn: (item) => item.supply.status,
      header: t('Supply status'),
      cell: ({ row }) => {
        const status = getSupplyChannelStatus(row.original.supply.status)
        return (
          <StatusBadge
            label={t(status.label)}
            variant={status.variant}
            copyable={false}
          />
        )
      },
      size: 150,
      meta: { mobileBadge: true },
    },
    {
      id: 'models',
      header: t('Models'),
      cell: ({ row }) => {
        const supply = row.original.supply
        return (
          <div className='flex min-w-[150px] flex-wrap gap-1'>
            <StatusBadge
              label={t('{{count}} listed', {
                count: supply.published_model_count,
              })}
              variant='neutral'
              copyable={false}
              showDot={false}
            />
            <StatusBadge
              label={t('{{count}} online', {
                count: supply.online_model_count,
              })}
              variant={supply.online_model_count > 0 ? 'success' : 'neutral'}
              copyable={false}
              showDot={false}
            />
            {supply.error_model_count > 0 && (
              <StatusBadge
                label={t('{{count}} abnormal', {
                  count: supply.error_model_count,
                })}
                variant='danger'
                copyable={false}
                showDot={false}
              />
            )}
          </div>
        )
      },
      enableSorting: false,
      size: 230,
      meta: { mobileOrder: 30 },
    },
    {
      id: 'price_multiplier',
      accessorFn: (item) => item.supply.price_multiplier,
      header: t('Multiplier'),
      cell: ({ row }) => (
        <span className='font-medium'>
          × {row.original.supply.price_multiplier}
        </span>
      ),
      size: 110,
      meta: { mobileOrder: 40 },
    },
    {
      id: 'probe_interval',
      header: t('Probe interval'),
      cell: ({ row }) => (
        <span className='text-muted-foreground text-sm'>
          {t('Text {{text}}m · Image {{image}}m', {
            text: row.original.supply.text_probe_minutes,
            image: row.original.supply.image_probe_minutes,
          })}
        </span>
      ),
      enableSorting: false,
      size: 180,
      meta: { mobileHidden: true },
    },
    {
      id: 'last_probe_at',
      accessorFn: (item) => item.supply.last_probe_at,
      header: t('Last probe'),
      cell: ({ row }) => (
        <span className='text-muted-foreground text-sm'>
          {row.original.supply.last_probe_at
            ? formatTimestamp(row.original.supply.last_probe_at)
            : '-'}
        </span>
      ),
      size: 180,
      meta: { mobileHidden: true },
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: ({ row }) => (
        <div className='flex items-center justify-end gap-1'>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  onClick={() => actions.onManageModels(row.original)}
                  aria-label={t('Manage models')}
                />
              }
            >
              <Settings2 />
            </TooltipTrigger>
            <TooltipContent>{t('Manage models')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  onClick={() => actions.onEdit(row.original)}
                  aria-label={t('Edit Channel')}
                />
              }
            >
              <Pencil />
            </TooltipTrigger>
            <TooltipContent>{t('Edit Channel')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  className='text-destructive hover:text-destructive'
                  onClick={() => actions.onDelete(row.original)}
                  aria-label={t('Delete Channel')}
                />
              }
            >
              <Trash2 />
            </TooltipTrigger>
            <TooltipContent>{t('Delete Channel')}</TooltipContent>
          </Tooltip>
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
      size: 140,
      meta: { pinned: 'right' as const },
    },
  ]
}
