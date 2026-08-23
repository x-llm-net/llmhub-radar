import { api } from '@/lib/api'

import type {
  TenantAdminDomain,
  TenantAdminMember,
  TenantAdminResponse,
  TenantAdminTenant,
  TenantAdminTenantsResponse,
} from './types'

export const tenantAdminQueryKey = ['hub-admin', 'tenants'] as const

export async function getHubAdminTenants(): Promise<TenantAdminTenantsResponse> {
  const response = await api.get('/api/hub/admin/tenants')
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
