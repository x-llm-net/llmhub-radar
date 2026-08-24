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

import { api } from '@/lib/api'

import type { TenantBrand, TenantBrandResponse } from '../tenant-brand/types'
import type {
  TenantAdminDomain,
  TenantAdminFinanceResponse,
  TenantAdminMember,
  TenantAdminResponse,
  TenantAdminTenant,
  TenantAdminTenantsResponse,
} from './types'

export const tenantAdminQueryKey = ['hub-admin', 'tenants'] as const
export const tenantAdminFinanceQueryKey = [
  'hub-admin',
  'tenant-finance',
] as const

export async function getHubAdminTenants(): Promise<TenantAdminTenantsResponse> {
  const response = await api.get('/api/hub/admin/tenants')
  return response.data
}

export async function getHubAdminTenantFinance(): Promise<TenantAdminFinanceResponse> {
  const response = await api.get('/api/hub/admin/tenants/finance')
  return response.data
}

export async function createHubAdminTenant(input: {
  name: string
  slug: string
}): Promise<TenantAdminResponse<TenantAdminTenant>> {
  const response = await api.post('/api/hub/admin/tenants', input)
  return response.data
}

export async function updateHubAdminTenantStatus(
  tenantId: number,
  status: string
): Promise<TenantAdminResponse<TenantAdminTenant>> {
  const response = await api.put(`/api/hub/admin/tenants/${tenantId}/status`, {
    status,
  })
  return response.data
}

export async function updateHubAdminTenantBrand(
  tenantId: number,
  brand: TenantBrand,
  logoFile?: File
): Promise<TenantBrandResponse> {
  if (logoFile) {
    const formData = new FormData()
    formData.append('brand', JSON.stringify(brand))
    formData.append('logo', logoFile)
    const response = await api.put(
      `/api/hub/admin/tenants/${tenantId}/brand`,
      formData
    )
    return response.data
  }
  const response = await api.put(
    `/api/hub/admin/tenants/${tenantId}/brand`,
    brand
  )
  return response.data
}

export async function createHubAdminTenantDomain(
  tenantId: number,
  input: { host: string; is_primary: boolean; trusted: boolean }
): Promise<TenantAdminResponse<TenantAdminDomain>> {
  const response = await api.post(
    `/api/hub/admin/tenants/${tenantId}/domains`,
    input
  )
  return response.data
}

export async function updateHubAdminTenantDomain(
  tenantId: number,
  domainId: number,
  input: {
    status?: string
    verification_status?: string
    is_primary?: boolean
  }
): Promise<TenantAdminResponse<TenantAdminDomain>> {
  const response = await api.put(
    `/api/hub/admin/tenants/${tenantId}/domains/${domainId}`,
    input
  )
  return response.data
}

export async function upsertHubAdminTenantMember(
  tenantId: number,
  input: { user_id: number; role: string }
): Promise<TenantAdminResponse<TenantAdminMember>> {
  const response = await api.post(
    `/api/hub/admin/tenants/${tenantId}/members`,
    input
  )
  return response.data
}

export async function updateHubAdminTenantMember(
  tenantId: number,
  userId: number,
  input: { status?: string; role?: string }
): Promise<TenantAdminResponse<TenantAdminMember>> {
  const response = await api.put(
    `/api/hub/admin/tenants/${tenantId}/members/${userId}`,
    input
  )
  return response.data
}
