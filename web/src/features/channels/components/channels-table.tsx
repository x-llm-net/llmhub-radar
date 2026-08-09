import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import type { Row } from '@tanstack/react-table'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DISABLED_ROW_DESKTOP,
  DISABLED_ROW_MOBILE,
  useDataTable,
} from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useMediaQuery } from '@/hooks'

import {
  getChannelOwnershipOptions,
  getChannels,
  getGroups,
  searchChannels,
} from '../api'
import {
  CHANNEL_STATUS,
  CHANNEL_STATUS_OPTIONS,
  DEFAULT_PAGE_SIZE,
} from '../constants'
import {
  aggregateChannelsByTag,
  channelsQueryKeys,
  getChannelTableRowId,
  isTagAggregateRow,
} from '../lib'
import type { Channel, ChannelSortBy } from '../types'
import { ChannelCard } from './channel-card'
import { ChannelListTablePage } from './channel-list-table'
import { useChannelsColumns } from './channels-columns'
import { useChannels } from './channels-provider'
import { DataTableBulkActions } from './data-table-bulk-actions'
import { useChannelListState } from './use-channel-list-state'

const route = getRouteApi('/_authenticated/channels/')
const CHANNELS_COLUMN_VISIBILITY_STORAGE_KEY = 'channels:column-visibility'
const CHANNELS_COLUMN_SIZING_STORAGE_KEY = 'channels:column-sizing'
const CHANNELS_VIEW_MODE_STORAGE_KEY = 'channels:view-mode'
const CHANNELS_STATUS_FILTER_STORAGE_KEY = 'channel-status-filter'
const CHANNEL_SORTABLE_COLUMNS = new Set<string>([
  'id',
  'name',
  'priority',
  'balance',
  'response_time',
  'test_time',
])

function isDisabledChannelRow(channel: Channel) {
  return (
    !isTagAggregateRow(channel) && channel.status !== CHANNEL_STATUS.ENABLED
  )
}

export function ChannelsTable() {
  const { t } = useTranslation()
  const {
    enableTagMode,
    idSort,
    batchMode,
    sensitiveVisible,
    setSensitiveVisible,
  } = useChannels()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const listState = useChannelListState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    sortableColumns: CHANNEL_SORTABLE_COLUMNS,
    includeGroupFilter: true,
    includeOwnershipFilter: true,
    statusStorageKey: CHANNELS_STATUS_FILTER_STORAGE_KEY,
    defaultPageSize: isMobile ? 10 : DEFAULT_PAGE_SIZE,
  })
  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
  })
  const groupOptions = useMemo(
    () => [
      { label: t('All Groups'), value: 'all' },
      ...(groupsData?.data || []).map((group) => ({
        label: sensitiveVisible ? group : '••••',
        value: group,
      })),
    ],
    [groupsData, sensitiveVisible, t]
  )
  const { data: ownershipData } = useQuery({
    queryKey: ['channel-ownership-options'],
    queryFn: getChannelOwnershipOptions,
    staleTime: 60 * 1000,
  })
  const ownershipOptions = useMemo(() => {
    const data = ownershipData?.data
    return [
      {
        label: t('All ownership'),
        value: 'all',
        count:
          (data?.platform_channel_count ?? 0) +
          (data?.provider_channel_count ?? 0),
      },
      {
        label: t('Platform operated'),
        value: 'platform',
        count: data?.platform_channel_count ?? 0,
      },
      {
        label: t('Provider supplied'),
        value: 'provider',
        count: data?.provider_channel_count ?? 0,
      },
      ...(data?.providers ?? []).map((provider) => ({
        label: provider.name,
        value: `provider:${provider.id}`,
        count: provider.channel_count,
      })),
    ]
  }, [ownershipData?.data, t])

  const params = {
    group: listState.queryParams.group,
    ownership: listState.queryParams.ownership,
    status: listState.queryParams.status,
    type: listState.queryParams.type,
    tag_mode: enableTagMode,
    id_sort: idSort,
    sort_by: listState.queryParams.sort_by as ChannelSortBy | undefined,
    sort_order: listState.queryParams.sort_order,
    p: listState.queryParams.p,
    page_size: listState.queryParams.page_size,
  }
  const shouldSearch = Boolean(
    listState.queryParams.keyword.trim() || listState.queryParams.model.trim()
  )
  const { data, isLoading, isFetching } = useQuery({
    queryKey: channelsQueryKeys.list({
      ...params,
      keyword: listState.queryParams.keyword,
      model: listState.queryParams.model,
    }),
    queryFn: () =>
      shouldSearch
        ? searchChannels({
            ...params,
            keyword: listState.queryParams.keyword,
            model: listState.queryParams.model,
          })
        : getChannels(params),
    placeholderData: (previousData) => previousData,
  })
  const channels = useMemo(() => {
    const items = data?.data?.items || []
    return enableTagMode && items.length > 0
      ? aggregateChannelsByTag(items)
      : items
  }, [data, enableTagMode])
  const columns = useChannelsColumns({ enableSelection: batchMode })
  const { table } = useDataTable({
    data: channels,
    columns,
    totalCount: data?.data?.total || 0,
    sorting: listState.sorting,
    initialColumnVisibility: { models: false, tag: false },
    columnVisibilityStorageKey: CHANNELS_COLUMN_VISIBILITY_STORAGE_KEY,
    columnSizingStorageKey: isMobile
      ? false
      : CHANNELS_COLUMN_SIZING_STORAGE_KEY,
    columnFilters: listState.columnFilters,
    pagination: listState.pagination,
    globalFilter: listState.globalFilter,
    enableRowSelection: batchMode
      ? (row: Row<Channel>) => !isTagAggregateRow(row.original)
      : false,
    onSortingChange: listState.onSortingChange,
    onColumnFiltersChange: listState.onColumnFiltersChange,
    onPaginationChange: listState.onPaginationChange,
    onGlobalFilterChange: listState.onGlobalFilterChange,
    getRowId: getChannelTableRowId,
    getSubRows: (row: Channel & { children?: Channel[] }) => row.children,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    withExpandedRowModel: true,
    enableColumnResizing: !isMobile,
    ensurePageInRange: listState.ensurePageInRange,
  })

  useEffect(() => {
    if (!batchMode) table.resetRowSelection()
  }, [batchMode, table])

  return (
    <ChannelListTablePage
      state={listState}
      table={table}
      columns={columns}
      typeCounts={data?.data?.type_counts}
      statusOptions={CHANNEL_STATUS_OPTIONS}
      groupOptions={groupOptions}
      ownershipOptions={ownershipOptions}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No Channels Found')}
      emptyDescription={t(
        'No channels available. Create your first channel to get started.'
      )}
      skeletonKeyPrefix='channel-skeleton'
      searchPlaceholder={t('Filter by name, ID, or key...')}
      modelSearchPlaceholder={t('Filter by model...')}
      toolbarPreActions={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='ghost'
                size='icon'
                onClick={() => setSensitiveVisible(!sensitiveVisible)}
                aria-label={sensitiveVisible ? t('Hide') : t('Show')}
                className='text-muted-foreground hover:text-foreground size-8'
              />
            }
          >
            {sensitiveVisible ? <Eye /> : <EyeOff />}
          </TooltipTrigger>
          <TooltipContent>
            {sensitiveVisible ? t('Hide') : t('Show')}
          </TooltipContent>
        </Tooltip>
      }
      enableCardView
      viewModeStorageKey={CHANNELS_VIEW_MODE_STORAGE_KEY}
      renderCard={(row, { isSelected }) => (
        <ChannelCard row={row} isSelected={isSelected} />
      )}
      cardGridClassName='grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3'
      applyHeaderSize
      getRowClassName={(row, context) => {
        if (!isDisabledChannelRow(row.original)) return undefined
        return context.isMobile ? DISABLED_ROW_MOBILE : DISABLED_ROW_DESKTOP
      }}
      bulkActions={batchMode ? <DataTableBulkActions table={table} /> : null}
    />
  )
}
