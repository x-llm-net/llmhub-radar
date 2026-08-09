import type {
  ColumnFiltersState,
  OnChangeFn,
  SortingState,
} from '@tanstack/react-table'
import { useMemo, useState } from 'react'

import { useDebouncedColumnFilter } from '@/components/data-table'
import { useTableUrlState, type NavigateFn } from '@/hooks/use-table-url-state'

export type ChannelListQueryParams = {
  keyword: string
  model: string
  status?: string
  type?: number
  group?: string
  ownership?: string
  sort_by?: string
  sort_order?: 'asc' | 'desc'
  p: number
  page_size: number
}

type ChannelListStateOptions = {
  search: Record<string, unknown>
  navigate: NavigateFn
  sortableColumns: ReadonlySet<string>
  includeGroupFilter?: boolean
  includeOwnershipFilter?: boolean
  statusStorageKey?: string
  defaultPageSize: number
}

export function useChannelListState(options: ChannelListStateOptions) {
  const [sorting, setSorting] = useState<SortingState>([])
  const columnFilterConfig = [
    {
      columnId: 'status',
      searchKey: 'status',
      type: 'array' as const,
      deserialize: (value: unknown) => {
        if (value !== undefined) return value
        if (!options.statusStorageKey) return []
        const stored = localStorage.getItem(options.statusStorageKey)
        return stored && stored !== 'all' ? [stored] : []
      },
    },
    { columnId: 'type', searchKey: 'type', type: 'array' as const },
    { columnId: 'model', searchKey: 'model', type: 'string' as const },
  ]
  if (options.includeGroupFilter) {
    columnFilterConfig.push({
      columnId: 'group',
      searchKey: 'group',
      type: 'array' as const,
    })
  }
  if (options.includeOwnershipFilter) {
    columnFilterConfig.push({
      columnId: 'ownership',
      searchKey: 'ownership',
      type: 'array' as const,
    })
  }

  const {
    globalFilter = '',
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: options.search,
    navigate: options.navigate,
    pagination: {
      defaultPage: 1,
      defaultPageSize: options.defaultPageSize,
    },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: columnFilterConfig,
  })

  const handleColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (
    updater
  ) => {
    onColumnFiltersChange((previous) => {
      const next = typeof updater === 'function' ? updater(previous) : updater
      if (options.statusStorageKey) {
        const status = next.find((filter) => filter.id === 'status')?.value as
          | string[]
          | undefined
        localStorage.setItem(options.statusStorageKey, status?.[0] ?? 'all')
      }
      return next
    })
  }

  const statusFilter =
    (columnFilters.find((filter) => filter.id === 'status')?.value as
      | string[]
      | undefined) ?? []
  const typeFilter =
    (columnFilters.find((filter) => filter.id === 'type')?.value as
      | string[]
      | undefined) ?? []
  const groupFilter =
    (columnFilters.find((filter) => filter.id === 'group')?.value as
      | string[]
      | undefined) ?? []
  const ownershipFilter =
    (columnFilters.find((filter) => filter.id === 'ownership')?.value as
      | string[]
      | undefined) ?? []
  const {
    value: modelFilter,
    inputValue: modelFilterInput,
    onChange: onModelFilterInputChange,
    onCompositionStart: onModelFilterCompositionStart,
    onCompositionEnd: onModelFilterCompositionEnd,
    resetInput: resetModelFilterInput,
  } = useDebouncedColumnFilter({
    columnFilters,
    columnId: 'model',
    onColumnFiltersChange,
  })

  const sortParams = useMemo(() => {
    const activeSort = sorting[0]
    if (!activeSort || !options.sortableColumns.has(activeSort.id)) {
      return {}
    }
    return {
      sort_by: activeSort.id,
      sort_order: activeSort.desc ? ('desc' as const) : ('asc' as const),
    }
  }, [options.sortableColumns, sorting])

  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting((previous) => {
      const next = typeof updater === 'function' ? updater(previous) : updater
      if (pagination.pageIndex > 0) {
        onPaginationChange({ ...pagination, pageIndex: 0 })
      }
      return next
    })
  }

  const firstValue = (values: string[]) => {
    const value = values.find((item) => item !== 'all')
    return value || undefined
  }
  const selectedType = firstValue(typeFilter)
  const queryParams: ChannelListQueryParams = {
    keyword: globalFilter,
    model: modelFilter,
    status: firstValue(statusFilter),
    type: selectedType ? Number(selectedType) : undefined,
    group: firstValue(groupFilter),
    ownership: firstValue(ownershipFilter),
    ...sortParams,
    p: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
  }

  return {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange: handleColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
    sorting,
    onSortingChange: handleSortingChange,
    queryParams,
    selectedType,
    modelFilterInput,
    onModelFilterInputChange,
    onModelFilterCompositionStart,
    onModelFilterCompositionEnd,
    resetModelFilterInput,
  }
}

export type ChannelListState = ReturnType<typeof useChannelListState>
