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
import { getRouteApi } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  DISABLED_ROW_DESKTOP,
  DISABLED_ROW_MOBILE,
  useDataTable,
} from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { ChannelListTablePage } from '@/features/channels/components/channel-list-table'
import { useChannelListState } from '@/features/channels/components/use-channel-list-state'
import { useMediaQuery } from '@/hooks'

import { getProviderChannels } from './api'
import { providerChannelsQueryKey } from './hooks/use-provider'
import {
  HUB_SUPPLY_STATUS_OPTIONS,
  useProviderChannelsColumns,
} from './provider-channels-columns'
import type {
  HubProviderChannel,
  HubProviderChannelListParams,
  HubProviderChannelSortBy,
} from './types'

const route = getRouteApi('/_authenticated/provider/')
const PROVIDER_CHANNEL_SORTABLE_COLUMNS = new Set<string>([
  'id',
  'name',
  'price_multiplier',
  'status',
  'last_probe_at',
  'updated_at',
])

type ProviderChannelsTableProps = {
  enabled: boolean
  onCreate: () => void
  onManageModels: (item: HubProviderChannel) => void
  onEdit: (item: HubProviderChannel) => void
  onDelete: (item: HubProviderChannel) => void
}

export function ProviderChannelsTable(props: ProviderChannelsTableProps) {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const listState = useChannelListState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    sortableColumns: PROVIDER_CHANNEL_SORTABLE_COLUMNS,
    statusStorageKey: 'provider-channels:status-filter',
    defaultPageSize: isMobile ? 10 : 20,
  })
  const params: HubProviderChannelListParams = {
    keyword: listState.queryParams.keyword,
    model: listState.queryParams.model,
    status: listState.queryParams.status,
    type: listState.queryParams.type,
    sort_by: listState.queryParams.sort_by as
      | HubProviderChannelSortBy
      | undefined,
    sort_order: listState.queryParams.sort_order,
    p: listState.queryParams.p,
    page_size: listState.queryParams.page_size,
  }
  const { data, isLoading, isFetching } = useQuery({
    queryKey: [...providerChannelsQueryKey, 'list', params],
    queryFn: () => getProviderChannels(params),
    enabled: props.enabled,
    staleTime: 30 * 1000,
    retry: false,
    refetchInterval: 15 * 1000,
    placeholderData: (previousData) => previousData,
  })
  const channels = data?.data?.items || []
  const columns = useProviderChannelsColumns({
    onManageModels: props.onManageModels,
    onEdit: props.onEdit,
    onDelete: props.onDelete,
  })
  const { table } = useDataTable({
    data: channels,
    columns,
    totalCount: data?.data?.total || 0,
    sorting: listState.sorting,
    columnFilters: listState.columnFilters,
    pagination: listState.pagination,
    globalFilter: listState.globalFilter,
    onSortingChange: listState.onSortingChange,
    onColumnFiltersChange: listState.onColumnFiltersChange,
    onPaginationChange: listState.onPaginationChange,
    onGlobalFilterChange: listState.onGlobalFilterChange,
    getRowId: (item) => String(item.channel.id),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableColumnResizing: !isMobile,
    ensurePageInRange: listState.ensurePageInRange,
  })

  return (
    <ChannelListTablePage
      state={listState}
      table={table}
      columns={columns}
      typeCounts={data?.data?.type_counts}
      statusOptions={HUB_SUPPLY_STATUS_OPTIONS}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No supply channels yet')}
      emptyDescription={t(
        'Create a channel to configure upstream access, select models, and manage listing.'
      )}
      emptyAction={
        <Button type='button' variant='outline' onClick={props.onCreate}>
          <Plus />
          {t('Create Supply Channel')}
        </Button>
      }
      skeletonKeyPrefix='provider-channel-skeleton'
      searchPlaceholder={t('Filter channels by name or URL...')}
      modelSearchPlaceholder={t('Filter by model...')}
      applyHeaderSize
      fixedHeight={false}
      getRowClassName={(row, context) => {
        if (row.original.supply.online_model_count > 0) return undefined
        return context.isMobile ? DISABLED_ROW_MOBILE : DISABLED_ROW_DESKTOP
      }}
    />
  )
}
