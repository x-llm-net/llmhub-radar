export type TenantAdminDomain = {
  id: number
  tenant_id: number
  host: string
  is_primary: boolean
  verification_status: 'pending' | 'verified' | 'rejected' | string
  status: 'active' | 'disabled' | string
  created_at: number
  updated_at: number
}

export type TenantAdminMember = {
  id: number
  tenant_id: number
  user_id: number
  username: string
  display_name: string
  email: string
  role: 'owner' | 'admin' | string
  status: 'active' | 'disabled' | string
  created_at: number
  updated_at: number
}

export type TenantAdminTenant = {
  id: number
  name: string
  slug: string
  status: 'active' | 'disabled' | string
  created_at: number
  updated_at: number
  domains: TenantAdminDomain[]
  members: TenantAdminMember[]
}

export type TenantAdminResponse<T = unknown> = {
  success: boolean
  message?: string
  data?: T
}

export type TenantAdminTenantsResponse = TenantAdminResponse<{
  items: TenantAdminTenant[]
}>
