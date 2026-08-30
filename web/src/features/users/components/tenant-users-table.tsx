/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTablePage,
  DISABLED_ROW_DESKTOP,
  DISABLED_ROW_MOBILE,
  useDataTable,
} from '@/components/data-table'
import { GroupBadge } from '@/components/group-badge'
import { LongText } from '@/components/long-text'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { formatTimestamp } from '@/lib/format'

import { getTenantUsers } from '../api'
import { USER_STATUS, USER_STATUSES, getUserStatusOptions } from '../constants'
import type { TenantUser } from '../types'

const route = getRouteApi('/_authenticated/users/')

function isDisabledUser(user: TenantUser) {
  return user.status === USER_STATUS.DISABLED
}

function getTenantUserRowClassName(
  user: TenantUser,
  isMobile: boolean
): string | undefined {
  if (!isDisabledUser(user)) return undefined
  return isMobile ? DISABLED_ROW_MOBILE : DISABLED_ROW_DESKTOP
}

function useTenantUserColumns(): ColumnDef<TenantUser>[] {
  const { t } = useTranslation()
  return useMemo(
    () => [
      {
        accessorKey: 'id',
        header: t('ID'),
        cell: ({ row }) => (
          <TableId value={row.original.id} className='w-[60px] text-sm' />
        ),
        enableSorting: false,
        size: 80,
      },
      {
        accessorKey: 'username',
        header: t('Username'),
        cell: ({ row }) => (
          <div className='flex min-w-[160px] flex-col gap-1'>
            <LongText className='max-w-[180px] font-medium'>
              {row.original.username}
            </LongText>
            {row.original.display_name &&
              row.original.display_name !== row.original.username && (
                <LongText className='text-muted-foreground max-w-[180px] text-xs'>
                  {row.original.display_name}
                </LongText>
              )}
          </div>
        ),
        enableHiding: false,
        size: 220,
        meta: { mobileTitle: true },
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        cell: ({ row }) => {
          const statusConfig =
            USER_STATUSES[row.original.status as keyof typeof USER_STATUSES]
          if (!statusConfig) return null
          return (
            <StatusBadge
              label={t(statusConfig.labelKey)}
              variant={statusConfig.variant}
              copyable={false}
            />
          )
        },
        enableSorting: false,
        size: 120,
        meta: { mobileBadge: true },
      },
      {
        accessorKey: 'request_count',
        header: t('Requests'),
        cell: ({ row }) => (
          <span className='font-mono text-sm tabular-nums'>
            {row.original.request_count.toLocaleString()}
          </span>
        ),
        enableSorting: false,
        size: 120,
      },
      {
        accessorKey: 'group',
        header: t('Group'),
        cell: ({ row }) => <GroupBadge group={row.original.group} />,
        enableSorting: false,
        size: 140,
      },
      {
        accessorKey: 'created_at',
        header: t('Created At'),
        cell: ({ row }) => (
          <span className='text-muted-foreground text-sm'>
            {row.original.created_at
              ? formatTimestamp(row.original.created_at)
              : '-'}
          </span>
        ),
        enableSorting: false,
        size: 180,
      },
      {
        accessorKey: 'last_login_at',
        header: t('Last Login'),
        cell: ({ row }) => (
          <span className='text-muted-foreground text-sm'>
            {row.original.last_login_at
              ? formatTimestamp(row.original.last_login_at)
              : '-'}
          </span>
        ),
        enableSorting: false,
        size: 180,
      },
    ],
    [t]
  )
}

export function TenantUsersTable() {
  const { t } = useTranslation()
  const columns = useTenantUserColumns()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: isMobile ? 10 : 20 },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'array' }],
  })
  const statusFilter =
    (columnFilters.find((filter) => filter.id === 'status')?.value as
      | string[]
      | undefined) ?? []

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'tenant-users',
      pagination.pageIndex + 1,
      pagination.pageSize,
      globalFilter,
      statusFilter,
    ],
    queryFn: async () => {
      const result = await getTenantUsers({
        keyword: globalFilter,
        status: statusFilter[0] ?? '',
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to load users'))
        return { items: [], total: 0 }
      }
      return {
        items: result.data?.items || [],
        total: result.data?.total || 0,
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const users = data?.items || []
  const { table } = useDataTable({
    data: users,
    columns,
    enableRowSelection: false,
    columnFilters,
    globalFilter,
    onPaginationChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    manualPagination: true,
    manualFiltering: true,
    totalCount: data?.total || 0,
    ensurePageInRange,
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No Users Found')}
      emptyDescription={t(
        'No users available. Try adjusting your search or filters.'
      )}
      skeletonKeyPrefix='tenant-users-skeleton'
      applyHeaderSize
      toolbarProps={{
        searchPlaceholder: t('Filter by username or name...'),
        searchDebounceMs: 500,
        filters: [
          {
            columnId: 'status',
            title: t('Status'),
            options: getUserStatusOptions(t),
            singleSelect: true,
          },
        ],
      }}
      getRowClassName={(row, { isMobile: mobile }) =>
        getTenantUserRowClassName(row.original, mobile)
      }
    />
  )
}
