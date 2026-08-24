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
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTablePage,
  DISABLED_ROW_DESKTOP,
  DISABLED_ROW_MOBILE,
  useDataTable,
} from '@/components/data-table'
import { getHubAdminTenants, tenantAdminQueryKey } from '@/features/tenant-admin/api'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { adminProvidersQueryKey, getAdminProviders } from './api'
import { useProvidersColumns } from './providers-columns'

const route = getRouteApi('/_authenticated/providers/')
const PROVIDER_STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'pending', label: 'Pending review' },
  { value: 'active', label: 'Active' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'disabled', label: 'Disabled' },
] as const

export function ProvidersTable() {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const isRoot = useAuthStore(
    (state) => state.auth.user?.role === ROLE.SUPER_ADMIN
  )
  const {
    globalFilter = '',
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
    columnFilters: [
      { columnId: 'status', searchKey: 'status', type: 'array' },
      { columnId: 'tenant_id', searchKey: 'tenant_id', type: 'array' },
    ],
  })
  const statusFilter =
    (columnFilters.find((filter) => filter.id === 'status')?.value as
      | string[]
      | undefined) ?? []
  const status = statusFilter.find((value) => value !== 'all')
  const tenantFilter =
    (columnFilters.find((filter) => filter.id === 'tenant_id')?.value as
      | string[]
      | undefined) ?? []
  const tenantID = tenantFilter.find((value) => value !== 'all')
  const tenantsQuery = useQuery({
    queryKey: tenantAdminQueryKey,
    queryFn: getHubAdminTenants,
    enabled: isRoot,
  })
  const params = {
    keyword: globalFilter,
    status,
    tenant_id: isRoot ? tenantID : undefined,
    p: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
  }
  const { data, isLoading, isFetching } = useQuery({
    queryKey: [...adminProvidersQueryKey, params],
    queryFn: async () => {
      const response = await getAdminProviders(params)
      if (!response.success) {
        toast.error(response.message || t('Failed to load providers'))
      }
      return response
    },
    placeholderData: (previousData) => previousData,
  })
  const providers = data?.data?.items || []
  const tenantOptions = tenantsQuery.data?.data?.items ?? []
  const columns = useProvidersColumns()
  const { table } = useDataTable({
    data: providers,
    columns,
    totalCount: data?.data?.total || 0,
    columnFilters,
    pagination,
    globalFilter,
    onColumnFiltersChange,
    onPaginationChange,
    onGlobalFilterChange,
    manualPagination: true,
    manualFiltering: true,
    initialColumnVisibility: { tenant_id: false },
    enableColumnResizing: !isMobile,
    ensurePageInRange,
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No providers found')}
      emptyDescription={t(
        'Providers will appear here after users create a provider profile.'
      )}
      skeletonKeyPrefix='provider-admin-skeleton'
      applyHeaderSize
      toolbarProps={{
        searchPlaceholder: t('Filter by provider, owner, email or website...'),
        searchDebounceMs: 500,
        filters: [
          ...(isRoot
            ? [
                {
                  columnId: 'tenant_id',
                  title: t('Reseller'),
                  options: [
                    { value: 'all', label: t('All tenants') },
                    { value: 'platform', label: t('Platform public pool') },
                    ...tenantOptions.map((tenant) => ({
                      value: String(tenant.id),
                      label: tenant.name,
                    })),
                  ],
                  singleSelect: true,
                },
              ]
            : []),
          {
            columnId: 'status',
            title: t('Status'),
            options: PROVIDER_STATUS_OPTIONS.map((option) => ({
              ...option,
              label: t(option.label),
            })),
            singleSelect: true,
          },
        ],
      }}
      getRowClassName={(row, context) => {
        if (row.original.status === 'active') return undefined
        return context.isMobile ? DISABLED_ROW_MOBILE : DISABLED_ROW_DESKTOP
      }}
    />
  )
}
