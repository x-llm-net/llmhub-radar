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

import type {
  HubProviderAdminListParams,
  HubProviderAdminListResponse,
  HubProviderAdminItem,
  HubProviderEarning,
  HubProviderSettlementSummary,
  HubProviderWithdrawalAdminItem,
  HubProviderWithdrawalStatus,
  PagedAdminResponse,
} from './types'

export const adminProvidersQueryKey = ['hub-admin', 'providers'] as const

export async function getAdminProviders(
  params: HubProviderAdminListParams
): Promise<HubProviderAdminListResponse> {
  const response = await api.get('/api/hub/admin/providers', { params })
  return response.data
}

export async function updateAdminProviderStatus(
  providerId: number,
  status: HubProviderAdminItem['status'],
  reviewRemark = ''
): Promise<{ success: boolean; message?: string }> {
  const response = await api.put(
    `/api/hub/admin/providers/${providerId}/status`,
    { status, review_remark: reviewRemark }
  )
  return response.data
}

export const adminWithdrawalsQueryKey = [
  'hub-admin',
  'provider-withdrawals',
] as const

export const adminProviderEarningsQueryKey = (providerId: number) =>
  ['hub-admin', 'providers', providerId, 'earnings'] as const

export async function getAdminProviderEarningSummary(
  providerId: number
): Promise<{
  success: boolean
  message?: string
  data?: HubProviderSettlementSummary
}> {
  const response = await api.get(
    `/api/hub/admin/providers/${providerId}/earnings/summary`
  )
  return response.data
}

export async function getAdminProviderEarnings(
  providerId: number,
  page: number,
  pageSize: number
): Promise<PagedAdminResponse<HubProviderEarning>> {
  const response = await api.get(
    `/api/hub/admin/providers/${providerId}/earnings`,
    { params: { p: page, page_size: pageSize } }
  )
  return response.data
}

export async function createAdminProviderEarningAdjustment(
  providerId: number,
  amountQuota: number,
  remark: string
): Promise<{ success: boolean; message?: string; data?: HubProviderEarning }> {
  const response = await api.post(
    `/api/hub/admin/providers/${providerId}/earnings/adjustments`,
    { amount_quota: amountQuota, remark },
    { skipBusinessError: true }
  )
  return response.data
}

export async function getAdminProviderWithdrawals(params: {
  status?: string
  p: number
  page_size: number
}): Promise<PagedAdminResponse<HubProviderWithdrawalAdminItem>> {
  const response = await api.get('/api/hub/admin/providers/withdrawals', {
    params,
  })
  return response.data
}

export async function updateAdminProviderWithdrawalStatus(
  withdrawalId: number,
  status: HubProviderWithdrawalStatus,
  adminRemark: string,
  payment?: {
    payout_currency: string
    payout_amount_minor: number
    exchange_rate: string
  }
): Promise<{
  success: boolean
  message?: string
  data?: HubProviderWithdrawalAdminItem
}> {
  const response = await api.put(
    `/api/hub/admin/providers/withdrawals/${withdrawalId}/status`,
    { status, admin_remark: adminRemark, ...payment },
    { skipBusinessError: true }
  )
  return response.data
}
