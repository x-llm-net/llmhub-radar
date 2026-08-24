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
  brand: {
    name: string
    logo_url: string
  }
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

export type TenantAdminFinanceSummary = {
  tenant_id: number
  tenant_name: string
  tenant_slug: string
  tenant_status: 'active' | 'disabled' | string
  summary: {
    gross_quota: number
    platform_fee_quota: number
    settled_income_quota: number
    pending_income_quota: number
    transferred_balance_quota: number
    paid_withdrawal_quota: number
    withdrawable_quota: number
  }
  reconciliation: {
    usage_entry_count: number
    settled_usage_entry_count: number
    pending_usage_entry_count: number
    balance_transfer_count: number
    withdrawal_count: number
    open_withdrawal_count: number
    paid_withdrawal_count: number
    reconciled: boolean
    issues: string[]
  }
}

export type TenantAdminFinanceResponse = TenantAdminResponse<{
  items: TenantAdminFinanceSummary[]
}>
