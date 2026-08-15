import type { HubProviderStatus } from '@/features/provider/types'
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
import type {
  HubProviderPayoutAccountSnapshot,
  HubProviderPayoutMethod,
} from '@/features/wallet/types'

export type HubProviderAdminItem = {
  id: number
  owner_user_id: number
  owner_username: string
  owner_display_name: string
  owner_email: string
  owner_status: number
  name: string
  slug: string
  website: string
  description: string
  logo_url: string
  contact_type: string
  contact_value: string
  support_type: string
  support_value: string
  status: HubProviderStatus
  review_remark: string
  reviewed_by_user_id: number
  reviewed_at: number
  channel_count: number
  online_channel_count: number
  available_model_count: number
  error_model_count: number
  last_probe_at: number
  upstream_usages: Array<{
    origin: string
    provider_count: number
    channel_count: number
  }>
  created_at: number
  updated_at: number
}

export type HubProviderAdminListParams = {
  keyword?: string
  status?: string
  p?: number
  page_size?: number
}

export type HubProviderAdminListResponse = {
  success: boolean
  message?: string
  data?: {
    items: HubProviderAdminItem[]
    total: number
    page: number
    page_size: number
  }
}

export type HubProviderSettlementSummary = {
  provider_id: number
  gross_quota: number
  platform_fee_quota: number
  settled_income_quota: number
  pending_income_quota: number
  reserved_withdrawal_quota: number
  paid_withdrawal_quota: number
  transferred_balance_quota: number
  withdrawable_quota: number
  platform_fee_basis_points: number
}

export type HubProviderEarning = {
  id: number
  request_id: string
  entry_type: 'usage' | 'adjustment' | 'balance_transfer'
  status: 'pending' | 'settled' | 'cancelled'
  provider_id: number
  consumer_user_id: number
  channel_id: number
  model_name: string
  gross_quota: number
  platform_fee_quota: number
  provider_income_quota: number
  supply_multiplier: number
  billing_ratio: number
  remark: string
  created_at: number
}

export type HubProviderWithdrawalStatus =
  | 'pending'
  | 'approved'
  | 'paid'
  | 'rejected'

export type HubProviderWithdrawalAdminItem = {
  id: number
  provider_id: number
  owner_user_id: number
  amount_quota: number
  status: HubProviderWithdrawalStatus
  payout_account_id: number
  payout_method: HubProviderPayoutMethod | ''
  payout_account?: HubProviderPayoutAccountSnapshot
  applicant_note: string
  payout_currency: string
  payout_amount_minor: number
  exchange_rate: string
  admin_remark: string
  admin_user_id: number
  reviewed_at: number
  paid_at: number
  created_at: number
  updated_at: number
  provider_name: string
  owner_username: string
  owner_email: string
}

export type PagedAdminResponse<T> = {
  success: boolean
  message?: string
  data?: {
    items: T[]
    total: number
    page: number
    page_size: number
  }
}
